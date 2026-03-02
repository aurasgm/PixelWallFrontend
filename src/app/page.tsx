'use client';

import dynamic from 'next/dynamic';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useState, useRef, useEffect, useCallback } from 'react';
import { MousePointer2, PaintBucket, ImagePlus, MessageSquare, Send, X } from 'lucide-react';
import bs58 from 'bs58';
import { toast } from 'sonner';

const PixelCanvas = dynamic(() => import('@/components/PixelCanvas'), { ssr: false });
const WalletMultiButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then(m => m.WalletMultiButton), { ssr: false });

interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export default function Home() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction, signMessage } = useWallet();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [activeTool, setActiveTool] = useState<'select' | 'paint' | 'image' | 'chat'>('paint');
  const [selectedColor, setSelectedColor] = useState<string>('#3b82f6'); // blue-500 default
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'model', parts: [{ text: "Hello! I am the Wall Broker. I manage this canvas real estate. Select some pixels or tell me where you want to buy. I can give you the best prices based on the neighborhood." }] }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [highlightPosition, setHighlightPosition] = useState<{ x: number, y: number, cantidad: number, width?: number, height?: number } | null>(null);

  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingPixels, setPendingPixels] = useState<any[]>([]); // Array para el Backend Transaction
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [imageScale, setImageScale] = useState<number>(50);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reservationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPixelsRef = useRef<any[]>([]);
  const isProcessingImageRef = useRef<boolean>(false);

  const PRESET_COLORS = [
    '#ffffff', // Blanco
    '#ef4444', // Rojo
    '#f97316', // Naranja
    '#eab308', // Amarillo
    '#22c55e', // Verde
    '#3b82f6', // Azul
    '#a855f7', // Morado
    '#ec4899', // Rosa
    '#09090b', // Negro
  ];

  // --- Smart Fetch ---
  const apiFetch = async (endpoint: string, options?: RequestInit) => {
    // Si estamos en Netlify/Pro, JAMÁS cargamos la cadena "localhost" para evitar los avisos de Heurística de Seguridad de Navegadores
    const isLocal = process.env.NODE_ENV === 'development';
    const primaryUrl = process.env.NEXT_PUBLIC_API_URL;

    // Si no hay URL de prod pero estamos en desarrollo
    if (!primaryUrl && isLocal) return fetch('http://localhost:3001' + endpoint, options);
    if (!primaryUrl) throw new Error("API URL undefined in Production");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(primaryUrl + endpoint, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok && res.status >= 500) throw new Error("Ngrok 500+ error");
      return res;
    } catch (error) {
      if (isLocal) {
        console.warn(`🌐 [API] Primary URL ${primaryUrl} failed. Falling back to local debugger...`);
        return fetch('http://localhost:3001' + endpoint, options);
      }
      throw error;
    }
  };

  // Reset auth state cuando la wallet se desconecta
  useEffect(() => {
    if (!connected) {
      setIsAuthenticated(false);
    }
  }, [connected]);

  // Autoscroll chat al final cuando hay mensajes nuevos
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isChatLoading]);

  const handleSignMessage = async () => {
    if (!publicKey || !signMessage) return;
    try {
      setIsSigning(true);
      const message = `Sign into AgentWall with wallet: ${publicKey.toString()}\nTimestamp: ${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureArray = await signMessage(encodedMessage);

      const signature = bs58.encode(signatureArray);

      const res = await apiFetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: publicKey.toString(),
          signature,
          message
        })
      });

      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
      } else {
        toast.error("Verification failed: " + data.error);
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to sign message.");
    } finally {
      setIsSigning(false);
    }
  };

  const processImageFile = useCallback((file: File) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setPendingImage(event.target.result as string);
          setActiveTool('image');
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const processImageUrl = useCallback(async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) {
        const file = new File([blob], "pasted-image.png", { type: blob.type });
        processImageFile(file);
      }
    } catch (e) {
      console.error("Failed to fetch image from URL", e);
    }
  }, [processImageFile]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;

      // Si estamos escribiendo en el chat, ignorar paste global
      if (document.activeElement?.tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'text') return;

      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFile(file);
            e.preventDefault();
            return;
          }
        }
      }

      // Fallback a URL pegada
      const text = e.clipboardData?.getData('text');
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        processImageUrl(text);
        e.preventDefault();
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [processImageFile, processImageUrl]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  const sendMessageToAgent = async (userMsg: string, currentHistory: ChatMessage[]) => {
    if (!userMsg.trim() || isChatLoading) return;

    const newUserMsg: ChatMessage = { role: 'user', parts: [{ text: userMsg }] };
    const newHistory = [...currentHistory, newUserMsg];

    setChatHistory(newHistory);
    setIsChatLoading(true);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: newHistory,
          context: {
            walletAddress: publicKey?.toString() || null,
            activeTool,
            selectedColor
          }
        })
      });
      const data = await res.json();
      if (data.text) {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: data.text }] }]);

        // Auto-Navigation: cuando el agente menciona coordenadas, mover y resaltar
        const coordsMatch = data.text.match(/\[(?:CLICK_BUY|CLICK_SELL):\s*(\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\]/);
        if (coordsMatch) {
          const newX = parseInt(coordsMatch[2]);
          const newY = parseInt(coordsMatch[3]);
          const newCantidad = parseInt(coordsMatch[1]);

          // Solo actualizar highlight si las coordenadas son diferentes (evita perder width/height)
          setHighlightPosition(prev => {
            if (prev && prev.x === newX && prev.y === newY) {
              return prev; // Preservar width/height existentes
            }
            return { cantidad: newCantidad, x: newX, y: newY };
          });
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Versión directa: envía al AI con un historial ya construido, sin añadir el user message al chat
  const sendMessageToAgentDirect = async (userMsg: string, history: ChatMessage[]) => {
    setIsChatLoading(true);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history,
          context: {
            walletAddress: publicKey?.toString() || null,
            activeTool,
            selectedColor
          }
        })
      });
      const data = await res.json();
      if (data.text) {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: data.text }] }]);

        const coordsMatch = data.text.match(/\[(?:CLICK_BUY|CLICK_SELL):\s*(\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\]/);
        if (coordsMatch) {
          const newX = parseInt(coordsMatch[2]);
          const newY = parseInt(coordsMatch[3]);
          const newCantidad = parseInt(coordsMatch[1]);
          setHighlightPosition(prev => {
            if (prev && prev.x === newX && prev.y === newY) return prev;
            return { cantidad: newCantidad, x: newX, y: newY };
          });
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (chatMessage.trim()) {
      sendMessageToAgent(chatMessage.trim(), chatHistory);
      setChatMessage('');
    }
  };

  const handleImagePlaced = async (data: { x: number, y: number, count: number, pixels: any[], width?: number, height?: number }) => {
    if (!publicKey) {
      if (activeTool === 'paint') toast.error("Please connect your wallet first.");
      return;
    }

    // Anti-spam lock invisible
    if (isProcessingImageRef.current) return;
    isProcessingImageRef.current = true;

    // UI INSTANTÁNEA: Abrimos el chat y seteamos la vista sin esperar a la red
    setPendingImage(null);
    setHighlightPosition({ x: data.x, y: data.y, cantidad: data.count, width: data.width, height: data.height });
    setActiveTool('chat');
    setPendingPixels(data.pixels);
    pendingPixelsRef.current = data.pixels;

    // Auto-Trigger LLM Message con coordenadas y dimensiones
    const dimStr = data.width && data.height ? ` (${data.width}x${data.height} grid)` : '';
    const msg = `I've just selected ${data.count} pixels starting at top-left X:${data.x}, Y:${data.y}${dimStr}. What's your quote for it?`;
    const userMsg: ChatMessage = { role: 'user', parts: [{ text: msg }] };

    // Info de reserva visual previa
    const reservationMsg: ChatMessage = { role: 'model', parts: [{ text: `⏳ **Verifying availability...** Please wait a second while I check if this exact area is free.` }] };

    // Construir historial manualmente y actualizar chat
    const fullHistory = [...chatHistory, reservationMsg, userMsg];
    setChatHistory(fullHistory);

    try {
      const res = await apiFetch('/api/pixels/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixels: data.pixels, walletAddress: publicKey.toString() })
      });
      const resData = await res.json();

      if (resData.success) {
        // Enviar al agente FUERA del updater para evitar doble llamada en strict mode SOLO si la reserva fue exitosa
        sendMessageToAgentDirect(msg, fullHistory);

        // Timer de expiración de la reserva (2 min) — usa ref para evitar stale closure
        if (reservationTimerRef.current) clearTimeout(reservationTimerRef.current);
        reservationTimerRef.current = setTimeout(() => {
          if (pendingPixelsRef.current.length > 0) {
            setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: `⏰ **Reservation expired** — Your pixel reservation has timed out. The pixels are now available for others. Select new pixels to try again.` }] }]);
            setPendingPixels([]);
            pendingPixelsRef.current = [];
            setHighlightPosition(null);
          }
        }, 2 * 60 * 1000);
      } else {
        // Rollback optimistic chat
        setChatHistory(chatHistory);
        toast.error(resData.error || "Some pixels are already reserved or occupied.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to reserve pixels. Server error.");
    } finally {
      isProcessingImageRef.current = false;
    }
  };

  // Liberar reservas al cerrar el chat sin comprar
  const handleCloseChat = async () => {
    // Cancelar timer de reserva
    if (reservationTimerRef.current) {
      clearTimeout(reservationTimerRef.current);
      reservationTimerRef.current = null;
    }
    if (pendingPixels.length > 0 && publicKey) {
      try {
        await apiFetch('/api/pixels/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pixels: pendingPixels.map((p: any) => ({ x: p.x, y: p.y })), walletAddress: publicKey.toString() })
        });
      } catch (e) {
        console.error('Failed to release pixels:', e);
      }
      setPendingPixels([]);
      pendingPixelsRef.current = [];
    }
    setHighlightPosition(null);
    setActiveTool('select');
  };

  // Helper para auto-generar los píxeles si la IA recomienda una zona que el usuario no tenía pre-seleccionada
  const handleAIBuyClicked = async (cantidad: number, x: number, y: number, precioRaw: number) => {
    if (!publicKey) {
      toast.error("Please connect your wallet first to buy.");
      return;
    }

    // Calculamos si el usuario ya tenía esto seleccionado o hay que auto-generarlo
    let pixelsToBuy = pendingPixels;

    // Si no hay píxeles pendientes, o la cantidad no coincide (la IA ofreció menos o más de los seleccionados originalmente), o la posición X/Y inicial no cuadra con lo seleccionado.
    const needsAutoGeneration = pixelsToBuy.length === 0 || pixelsToBuy.length !== cantidad || pixelsToBuy[0]?.x !== x || pixelsToBuy[0]?.y !== y;

    if (needsAutoGeneration) {
      const simulatedPixels = [];
      const sideLength = Math.ceil(Math.sqrt(cantidad)); // Asumimos un cuadrado a partir de la esquina X,Y

      let currX = x;
      let currY = y;
      let count = 0;

      for (let gridY = 0; gridY < sideLength && count < cantidad; gridY++) {
        for (let gridX = 0; gridX < sideLength && count < cantidad; gridX++) {
          const checkX = currX + gridX;
          const checkY = currY + gridY;

          if (checkX > 299 || checkY > 299 || checkX < 0 || checkY < 0) {
            toast.error(`Error: The AI suggested coordinates outside the canvas bounds. Valid area is 0 to 299.`);
            return;
          }

          simulatedPixels.push({
            x: checkX,
            y: checkY,
            color: selectedColor || '#3b82f6',
            walletAddress: publicKey.toString()
          });
          count++;
        }
      }

      // Validamos con el backend de forma asíncrona ANTES de abrir Phantom
      try {
        const reserveRes = await apiFetch('/api/pixels/reserve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pixels: simulatedPixels, walletAddress: publicKey.toString() })
        });
        const reserveData = await reserveRes.json();
        if (!reserveRes.ok || !reserveData.success) {
          toast.error(reserveData.error || "The AI proposed an area that is already occupied.");
          return;
        }
      } catch (e) {
        console.error("Reserve error:", e);
        toast.error("Network error checking pixel availability.");
        return;
      }

      setPendingPixels(simulatedPixels);
      pendingPixelsRef.current = simulatedPixels;
      setHighlightPosition({ x, y, cantidad, width: sideLength, height: sideLength });

      // Procedemos a la compra con el nuevo array forzado
      handleBuy(cantidad, x, y, precioRaw, simulatedPixels);
    } else {
      // Todo cuadra, procedemos normal
      handleBuy(cantidad, x, y, precioRaw, pixelsToBuy);
    }
  };

  const handleBuy = async (cantidad: number, x: number, y: number, precioRaw: number, overridePixels?: any[]) => {
    if (!publicKey || !connected) {
      toast.error("Please connect your wallet first to buy.");
      return;
    }

    const pixelsToProcess = overridePixels || pendingPixels;

    if (pixelsToProcess.length === 0) {
      toast.error("Error: Could not generate pixel data for checkout.");
      return;
    }

    setIsPurchasing(true);

    // Step 1: Signing
    setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: `⏳ **Step 1/3** — Opening wallet for signature...` }] }]);

    try {
      const precioLamports = Math.round((precioRaw / 100) * LAMPORTS_PER_SOL); // TODO: quitar /100 en producción
      const treasuryWallet = new PublicKey(process.env.NEXT_PUBLIC_TREASURY_WALLET || "11111111111111111111111111111111");

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasuryWallet,
          lamports: precioLamports,
        })
      );

      const signature = await sendTransaction(transaction, connection);

      // Step 2: Submitted
      setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: `📡 **Step 2/3** — Transaction submitted! Waiting for on-chain confirmation...\n\`${signature.substring(0, 12)}...\`` }] }]);

      // Step 3: Verifying on backend
      const res = await apiFetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          pixels: pixelsToProcess,
          walletAddress: publicKey.toString(),
          amount: precioRaw
        })
      });

      const data = await res.json();
      if (res.ok) {
        setPendingPixels([]);
        pendingPixelsRef.current = [];
        setHighlightPosition(null);
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: `✅ **Step 3/3 — Purchase Complete!**\n\n🎨 **${data.pixelsSaved} pixels** are now permanently yours.\n🔗 TX: \`${signature.substring(0, 8)}...${signature.substring(signature.length - 4)}\`` }] }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: `❌ **Verification failed** — ${data.error}\n\nYour transaction was sent but the server couldn't confirm it yet. Don't worry, your SOL is safe. Try again in a moment.` }] }]);
      }

    } catch (error: any) {
      console.error("Payment failed", error);
      const msg = error?.message?.includes('rejected') || error?.message?.includes('cancelled')
        ? `🚫 **Transaction cancelled** — You rejected the signature request. No SOL was spent.`
        : `❌ **Transaction failed** — ${error?.message || 'Unknown error'}. Please try again.`;
      setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: msg }] }]);
    } finally {
      setIsPurchasing(false);
    }
  };

  // Helper: Parsea markdown inline (**bold**, *italic*) a React elements
  const formatMarkdown = (raw: string, keyPrefix: string = 'md') => {
    const tokens: React.ReactNode[] = [];
    // Regex: primero bold (**...**), después italic (*...*)
    const mdRegex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let idx = 0;

    while ((m = mdRegex.exec(raw)) !== null) {
      if (m.index > last) {
        tokens.push(raw.substring(last, m.index));
      }
      if (m[1]) {
        // Bold
        tokens.push(<strong key={`${keyPrefix}-b-${idx}`} className="font-bold text-white">{m[1]}</strong>);
      } else if (m[2]) {
        // Italic
        tokens.push(<em key={`${keyPrefix}-i-${idx}`} className="italic text-zinc-300">{m[2]}</em>);
      }
      last = m.index + m[0].length;
      idx++;
    }
    if (last < raw.length) tokens.push(raw.substring(last));
    return tokens.length > 0 ? tokens : raw;
  };

  const renderChatMessage = (text: string) => {
    // Parser Regex para [CLICK_BUY: cantidad, X, Y, precio]
    const buyRegex = /\[CLICK_BUY:\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\]/g;
    // Parser Regex para [CLICK_SELL: cantidad, X, Y, precio] 
    const sellRegex = /\[CLICK_SELL:\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\]/g;

    const parts = [];
    let lastIndex = 0;

    // Primero parseamos BUY
    const buyMatches = [...text.matchAll(buyRegex)];
    // Luego parseamos SELL 
    const sellMatches = [...text.matchAll(sellRegex)];

    // Combinamos y ordenamos por índice de aparición
    const allMatches = [...buyMatches.map(m => ({ ...m, type: 'BUY' })), ...sellMatches.map(m => ({ ...m, type: 'SELL' }))]
      .sort((a, b) => a.index! - b.index!);

    if (allMatches.length === 0) return <p className="text-sm whitespace-pre-wrap leading-relaxed">{formatMarkdown(text, 'solo')}</p>;

    allMatches.forEach((match, i) => {
      // Agregar texto previo al match
      if (match.index! > lastIndex) {
        parts.push(<span key={`text-${i}`} className="whitespace-pre-wrap inline">{formatMarkdown(text.substring(lastIndex, match.index), `pre-${i}`)}</span>);
      }

      const matchArray = match as unknown as RegExpMatchArray;
      const type = (match as { type: string }).type;

      const cantidad = matchArray[1];
      const x = matchArray[2];
      const y = matchArray[3];
      const precio = matchArray[4];

      if (type === 'BUY') {
        parts.push(
          <div key={`buy-${i}`} className="my-3 p-3 bg-zinc-900/50 border border-emerald-500/30 rounded-xl flex flex-col gap-2 shadow-inner">
            <div className="flex justify-between items-center">
              <span className="text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-1 rounded">OFFER GENERATED</span>
              <span className="text-xs text-zinc-400 font-mono">Pos: {x},{y}</span>
            </div>
            <p className="text-sm font-medium">{cantidad} Pixels for <span className="text-emerald-400 font-bold">{precio} SOL</span></p>
            <button
              onClick={() => handleAIBuyClicked(parseInt(cantidad), parseInt(x), parseInt(y), parseFloat(precio))}
              disabled={isPurchasing}
              className={`mt-1 w-full py-2 text-white font-bold rounded-lg transition-all shadow-md text-sm ${isPurchasing ? 'bg-zinc-600 cursor-not-allowed animate-pulse' : 'bg-emerald-600 hover:bg-emerald-500'}`}
            >
              {isPurchasing ? '⏳ Processing...' : 'Sign & Buy'}
            </button>
          </div>
        );
      } else {
        parts.push(
          <div key={`sell-${i}`} className="my-3 p-3 bg-zinc-900/50 border border-blue-500/30 rounded-xl flex flex-col gap-2 shadow-inner">
            <div className="flex justify-between items-center">
              <span className="text-xs text-blue-400 font-semibold bg-blue-500/10 px-2 py-1 rounded">SELL REQUEST</span>
              <span className="text-xs text-zinc-400 font-mono">Pos: {x},{y}</span>
            </div>
            <p className="text-sm font-medium">List {cantidad} Pixels for <span className="text-blue-400 font-bold">{precio} SOL</span></p>
            <button
              onClick={() => toast.info(`Mock Sell Intent: Listing ${cantidad} pixels at ${x},${y} for ${precio} SOL.`)}
              className="mt-1 w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors shadow-md text-sm"
            >
              List on Market
            </button>
          </div>
        );
      }

      lastIndex = match.index! + match[0].length;
    });

    // Añadir el resto del texto
    if (lastIndex < text.length) {
      parts.push(<span key="text-end" className="whitespace-pre-wrap inline">{formatMarkdown(text.substring(lastIndex), 'end')}</span>);
    }

    return <div className="text-sm leading-relaxed">{parts}</div>;
  };

  return (
    <div
      className="relative min-h-screen w-full bg-zinc-950 overflow-hidden text-white flex"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Canvas Area (Ocupa el resto del espacio disponible al desplegar chat) */}
      <div className={`relative flex-1 transition-all duration-300 ease-in-out ${activeTool === 'chat' ? 'sm:mr-96' : 'mr-0'}`}>
        <PixelCanvas activeTool={activeTool} selectedColor={selectedColor} pendingImage={pendingImage} imageScale={imageScale} chatOpen={activeTool === 'chat'} highlightPosition={highlightPosition} onImagePlaced={handleImagePlaced} />

        {/* Auth Overlay */}
        {!connected && (
          <main className="absolute inset-0 pointer-events-none flex flex-col items-center p-8 z-10 transition-opacity duration-500">
            <div className="mt-10 space-y-2 text-center pointer-events-auto bg-black/40 p-6 rounded-3xl backdrop-blur-md border border-white/5">
              <h1 className="text-4xl md:text-5xl font-bold tracking-tighter drop-shadow-lg">
                Agent<span className="text-blue-500">Wall</span>
              </h1>
              <p className="text-base text-zinc-300">The AI-driven dynamic pixel canvas on Solana.</p>
            </div>
            <div className="mt-auto mb-10 w-full max-w-sm pointer-events-auto">
              <div className="p-6 border border-zinc-800 rounded-2xl bg-zinc-900/80 backdrop-blur-xl shadow-2xl">
                <p className="mb-4 text-sm text-center text-zinc-300 font-medium">Connect wallet to buy & sell pixels</p>
                <div className="flex justify-center">
                  <WalletMultiButton style={{ backgroundColor: '#3b82f6', borderRadius: '0.75rem', padding: '0 2rem' }} />
                </div>
              </div>
            </div>
          </main>
        )}

        {connected && !isAuthenticated && (
          <main className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8 z-50 bg-black/80 backdrop-blur-sm transition-opacity duration-500">
            <div className="space-y-6 text-center pointer-events-auto bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-2xl max-w-sm w-full">
              <div className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-2">
                  <span className="text-blue-400 text-2xl font-bold">🔐</span>
                </div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Verify Wallet</h2>
                <p className="text-sm text-zinc-400">Sign a message to prove ownership and securely access AgentWall.</p>
              </div>

              <button
                onClick={handleSignMessage}
                disabled={isSigning}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all"
              >
                {isSigning ? 'Awaiting Signature...' : 'Sign to Login'}
              </button>

              <div className="flex w-full justify-center pt-4 mt-2">
                <WalletMultiButton style={{ backgroundColor: 'transparent', color: '#a1a1aa', border: '1px solid #27272a', borderRadius: '0.75rem', fontSize: '0.875rem', padding: '0 1rem' }} />
              </div>
            </div>
          </main>
        )}

        {connected && isAuthenticated && (
          <>
            <div className="absolute inset-0 z-20 pointer-events-none p-4 flex flex-col justify-between">

              {/* Botón de Wallet Arriba a la Derecha */}
              <div className="pointer-events-auto absolute top-4 right-4 sm:top-6 sm:right-6 z-30">
                <WalletMultiButton style={{ backgroundColor: '#18181b80', backdropFilter: 'blur(12px)', border: '1px solid #3f3f46', borderRadius: '0.75rem', height: '40px', fontSize: '0.875rem', padding: '0 1rem' }} />
              </div>

              {/* Toolbar Central (Bottom on Mobile, Top Center on Desktop) */}
              <div className={`pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 w-max max-w-[95vw] overflow-x-auto sm:overflow-visible sm:w-auto sm:max-w-max sm:top-6 sm:bottom-auto bg-black/80 sm:bg-black/60 backdrop-blur-xl border border-zinc-800 rounded-2xl p-2 flex flex-nowrap shadow-2xl items-center z-20 ${activeTool === 'chat' ? 'hidden sm:flex' : ''} [&::-webkit-scrollbar]:hidden`}>
                <div className="flex gap-2 items-center min-w-max">
                  <button
                    onClick={() => setActiveTool('select')}
                    className={`p-2 sm:p-3 rounded-xl transition-all ${activeTool === 'select' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Select Pixel"
                  >
                    <MousePointer2 size={20} className="sm:w-6 sm:h-6" />
                  </button>
                  <button
                    onClick={() => setActiveTool('paint')}
                    className={`p-2 sm:p-3 rounded-xl transition-all ${activeTool === 'paint' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Paint Pixel"
                  >
                    <PaintBucket size={20} className="sm:w-6 sm:h-6" />
                  </button>
                  <button
                    onClick={() => {
                      setActiveTool('image');
                    }}
                    className={`p-2 sm:p-3 rounded-xl transition-all ${activeTool === 'image' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Upload Image"
                  >
                    <ImagePlus size={20} className="sm:w-6 sm:h-6" />
                  </button>



                  {/* Image Settings */}
                  {activeTool === 'image' && (
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0 animate-in fade-in slide-in-from-left-4 duration-300">
                      <div className="w-px h-8 bg-zinc-800 mx-1 hidden sm:block"></div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl text-sm text-white font-semibold whitespace-nowrap shadow-md shrink-0"
                      >
                        Upload Image
                      </button>
                      <span className="text-sm text-zinc-500 whitespace-nowrap hidden lg:inline-block">
                        or drop anywhere
                      </span>
                      <div className="w-px h-8 bg-zinc-800 mx-1 hidden sm:block"></div>
                      <div className="flex items-center justify-center gap-2 bg-zinc-900/50 px-3 py-2 rounded-xl border border-zinc-800/50 shrink-0">
                        <span className="text-xs text-zinc-400 font-medium whitespace-nowrap">Size:</span>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={imageScale}
                          onChange={(e) => setImageScale(Number(e.target.value))}
                          className="w-full sm:w-24 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
                          title={`${imageScale} pixels max dimension`}
                        />
                        <span className="text-xs text-zinc-300 w-6 font-mono text-right">{imageScale}</span>
                      </div>
                    </div>
                  )}

                  {/* Color Palette (Aparece cuando pintas) */}
                  {activeTool === 'paint' && (
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 animate-in fade-in slide-in-from-left-4 duration-300 px-2 sm:px-0">
                      <div className="w-px h-8 bg-zinc-800 mx-1 hidden sm:block"></div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {PRESET_COLORS.map(color => (
                          <button
                            key={color}
                            onClick={() => setSelectedColor(color)}
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex-shrink-0 transition-transform hover:scale-110 ${selectedColor === color ? 'border-white scale-110 shadow-lg' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                        <div className="w-px h-6 bg-zinc-800 mx-1"></div>
                        <input
                          type="color"
                          value={selectedColor}
                          onChange={(e) => setSelectedColor(e.target.value)}
                          className="w-7 h-7 sm:w-8 sm:h-8 rounded-full cursor-pointer border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-2 [&::-webkit-color-swatch]:border-zinc-700 [&::-webkit-color-swatch]:rounded-full overflow-hidden ml-auto sm:ml-0"
                          title="Custom Color"
                        />
                      </div>
                    </div>
                  )}

                  {/* Input FILE nativo oculto */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/png, image/jpeg, image/webp"
                    onChange={handleImageUpload}
                  />

                  {/* Action Button: Buy/Negotiate (Aparece si hay pendingPixels) */}
                  {pendingPixels.length > 0 && activeTool !== 'chat' && (
                    <>
                      <div className="w-px h-8 bg-zinc-800 mx-1 hidden sm:block"></div>
                      <button
                        onClick={() => setActiveTool('chat')}
                        className="px-5 py-2 sm:ml-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all animate-pulse whitespace-nowrap shrink-0"
                      >
                        Negotiate Price ✨
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* AI Agent Floating Button (FAB) */}
            <button
              onClick={() => activeTool === 'chat' ? handleCloseChat() : setActiveTool('chat')}
              className={`fixed bottom-28 right-4 sm:bottom-6 sm:right-6 z-30 p-3 sm:p-4 rounded-2xl flex items-center gap-2 sm:gap-3 transition-all duration-300 shadow-2xl overflow-hidden group
              ${activeTool === 'chat'
                  ? 'bg-zinc-800 text-zinc-400 border border-zinc-700/50 scale-95 opacity-0 pointer-events-none'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-105 border border-emerald-500/50 opacity-100 pointer-events-auto cursor-pointer animate-bounce-slow'
                }`}
              title="Talk to Agent Wall Broker"
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent group-hover:translate-x-full transition-transform duration-700" />
              <div className="w-8 h-8 sm:w-8 sm:h-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm shadow-inner shrink-0">
                <MessageSquare size={16} className="text-white" />
              </div>
              <div className="flex flex-col items-start pr-1 sm:pr-2">
                <span className="font-bold text-xs sm:text-sm leading-tight text-white drop-shadow-sm">Wall Broker</span>
                <span className="text-[9px] sm:text-[10px] text-emerald-100 uppercase tracking-widest font-semibold">AI Agent</span>
              </div>
            </button>
          </>
        )}
      </div> {/* Fin del Canvas Area */}

      {/* AI Agent Chat Sidebar */}
      <div className={`fixed right-0 top-0 h-[100dvh] w-full sm:w-96 bg-zinc-900 border-l border-zinc-800 shadow-2xl transition-transform duration-300 ease-in-out z-50 flex flex-col ${activeTool === 'chat' ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50 relative z-[60]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-900 flex items-center justify-center border border-emerald-400/30">
              <MessageSquare size={20} className="text-white bg-clip-text" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Wall Broker</h3>
              <p className="text-xs text-emerald-400">AI Agent Online</p>
            </div>
          </div>
          <button onClick={handleCloseChat} className="p-2 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800 pointer-events-auto z-[60] shrink-0" title="Close Chat">
            <X size={24} />
          </button>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`rounded-2xl p-3 sm:p-4 max-w-[85%] shadow-sm overflow-x-hidden ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-sm' : 'bg-zinc-800 border border-zinc-700/50 text-zinc-200 rounded-tl-sm'}`}>
                {renderChatMessage(msg.parts[0].text)}
              </div>
            </div>
          ))}
          {isChatLoading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 rounded-2xl rounded-tl-sm p-4 border border-zinc-700/50 flex items-center space-x-1 h-10">
                <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse"></div>
                <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse delay-75"></div>
                <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse delay-150"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Text */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/50">
          <form onSubmit={handleSendMessage} className="relative">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              placeholder="Negotiate prices, ask for advice..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
            />
            <button
              type="submit"
              disabled={!chatMessage.trim()}
              className="absolute right-2 top-2 p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div >
  );
}
