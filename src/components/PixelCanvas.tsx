'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Stage, Container, Sprite, Graphics } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { toast } from 'sonner';
import { io } from 'socket.io-client';

interface ViewportProps {
    walletAddress?: string;
    activeTool: string;
    selectedColor: string;
    pendingImage?: string | null;
    imageScale?: number;
    chatOpen?: boolean;
    highlightPosition?: { cantidad?: number, x: number, y: number, width?: number, height?: number } | null;
    onImagePlaced?: (data: { x: number; y: number; count: number; pixels: any[]; width?: number; height?: number }) => void;
    onHoverPixel?: (info: { x: number, y: number, color: string, ownerWallet: string, screenX: number, screenY: number, pricePaid: number } | null) => void;
    isStaged?: boolean;
    connected?: boolean;
}

interface PixelCanvasProps {
    activeTool: string;
    selectedColor: string;
    pendingImage?: string | null;
    imageScale?: number;
    chatOpen?: boolean;
    highlightPosition?: { cantidad?: number, x: number, y: number, width?: number, height?: number } | null;
    onImagePlaced?: (data: { x: number; y: number; count: number; pixels: any[]; width?: number; height?: number }) => void;
    isStaged?: boolean;
}

const STAGE_OPTIONS = { backgroundColor: 0x18181b, antialias: true };

const ViewportComponent = ({ walletAddress, activeTool, selectedColor, pendingImage, imageScale = 50, chatOpen, highlightPosition, isStaged, connected, onImagePlaced, onHoverPixel }: ViewportProps) => {
    const [viewport, setViewport] = useState<Viewport | null>(null);
    const [windowDimensions, setWindowDimensions] = useState({
        width: typeof window !== 'undefined' ? window.innerWidth : 800,
        height: typeof window !== 'undefined' ? window.innerHeight : 600
    });
    const activeToolRef = useRef(activeTool);
    const selectedColorRef = useRef(selectedColor);
    const pendingImageRef = useRef(pendingImage);
    const imageScaleRef = useRef(imageScale);
    const chatOpenRef = useRef(chatOpen);
    const highlightGraphicsRef = useRef<any>(null); // PIXI.Graphics instance
    const walletAddressRef = useRef(walletAddress);
    const loadedPixelsRef = useRef<Map<string, any>>(new Map());
    const onHoverPixelRef = useRef(onHoverPixel);
    const isStagedRef = useRef(isStaged);

    useEffect(() => {
        isStagedRef.current = isStaged;
    }, [isStaged]);

    useEffect(() => {
        onHoverPixelRef.current = onHoverPixel;
    }, [onHoverPixel]);

    useEffect(() => {
        activeToolRef.current = activeTool;
    }, [activeTool]);

    useEffect(() => {
        selectedColorRef.current = selectedColor;
    }, [selectedColor]);

    useEffect(() => {
        pendingImageRef.current = pendingImage;
    }, [pendingImage]);

    useEffect(() => {
        imageScaleRef.current = imageScale;
    }, [imageScale]);

    useEffect(() => {
        walletAddressRef.current = walletAddress;
    }, [walletAddress]);

    useEffect(() => {
        chatOpenRef.current = chatOpen;
    }, [chatOpen]);

    useEffect(() => {
        const handleResize = () => {
            setWindowDimensions({
                width: window.innerWidth,
                height: window.innerHeight
            });
            if (viewport) {
                viewport.resize(window.innerWidth, window.innerHeight);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [viewport]);

    // Lógica principal del canvas y navegación remota
    useEffect(() => {
        if (viewport && highlightPosition && highlightGraphicsRef.current) {
            const hg = highlightGraphicsRef.current;
            const gridSize = 10;
            let cancelled = false;

            // Limpiar cualquier highlight previo
            hg.clear();

            const topLeftX = highlightPosition.x * gridSize;
            const topLeftY = highlightPosition.y * gridSize;

            let rectW: number;
            let rectH: number;
            if (highlightPosition.width && highlightPosition.height) {
                rectW = highlightPosition.width * gridSize;
                rectH = highlightPosition.height * gridSize;
            } else {
                const side = Math.ceil(Math.sqrt(highlightPosition.cantidad || 1));
                rectW = side * gridSize;
                rectH = side * gridSize;
            }

            const centerX = topLeftX + rectW / 2;
            const centerY = topLeftY + rectH / 2;

            // Pulso continuo del highlight
            let time = 0;
            let animationFrameId: number;

            const animateGlow = () => {
                if (cancelled || !hg || hg.destroyed) return;
                time += 0.05;
                hg.clear();
                hg.alpha = 0.5 + Math.sin(time * 2) * 0.3;
                hg.lineStyle(3, 0x10b981, 1);
                hg.beginFill(0x10b981, 0.25);
                hg.drawRect(topLeftX - 2, topLeftY - 2, rectW + 4, rectH + 4);
                hg.endFill();
                animationFrameId = requestAnimationFrame(animateGlow);
            };
            animationFrameId = requestAnimationFrame(animateGlow);

            // Cálculo del zoom y offset
            const CHAT_PANEL_W = 384;
            const isMobile = windowDimensions.width < 640;
            const chatIsOpen = chatOpenRef.current && !isMobile;
            const visibleW = chatIsOpen ? windowDimensions.width - CHAT_PANEL_W : windowDimensions.width;
            const screenH = windowDimensions.height;
            const scaleX = visibleW / (rectW * 1.5);
            const scaleY = screenH / (rectH * 1.5);
            const targetScale = Math.max(0.5, Math.min(scaleX, scaleY, 4));

            const chatOffsetWorld = chatIsOpen ? (CHAT_PANEL_W / 2) / targetScale : 0;
            const adjustedCenterX = centerX + chatOffsetWorld;

            // Animación manual 100% segura y defensiva contra WebGL crashes
            let startX = viewport.center.x;
            let startY = viewport.center.y;
            let startScale = viewport.scale.x;

            // Fallback si la cámara estaba en un estado raro
            if (isNaN(startX) || isNaN(startY) || isNaN(startScale)) {
                startX = adjustedCenterX;
                startY = centerY;
                startScale = targetScale;
            }

            const duration = 600; // ms
            const startTime = performance.now();
            let cameraFrameId: number;

            const animateCamera = (now: number) => {
                if (cancelled) return;
                try {
                    const elapsed = now - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    // easeInOutQuad
                    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

                    const currentX = startX + (adjustedCenterX - startX) * eased;
                    const currentY = startY + (centerY - startY) * eased;
                    const currentScale = startScale + (targetScale - startScale) * eased;

                    // VALIDACIÓN CRÍTICA: Prevenir el crash de PIXI (pantalla gris) asegurando números válidos
                    if (Number.isFinite(currentX) && Number.isFinite(currentY) && Number.isFinite(currentScale) && currentScale > 0.01) {
                        viewport.moveCenter(currentX, currentY);
                        viewport.scaled = currentScale;
                    }

                    if (progress < 1) {
                        cameraFrameId = requestAnimationFrame(animateCamera);
                    }
                } catch (e) {
                    console.warn('Safe camera animation interrupted:', e);
                }
            };

            cameraFrameId = requestAnimationFrame(animateCamera);

            return () => {
                cancelled = true;
                if (cameraFrameId) cancelAnimationFrame(cameraFrameId);
                if (hg && !hg.destroyed) hg.clear();
            };
        } else if (highlightGraphicsRef.current && !highlightPosition) {
            // Cuando highlightPosition se pone a null, limpiar el gráfico
            highlightGraphicsRef.current.clear();
        }
    }, [highlightPosition, viewport]);

    return (
        <Stage
            width={windowDimensions.width}
            height={windowDimensions.height}
            options={STAGE_OPTIONS}
            onMount={(app) => {
                if (!app.view) return; // Prevent Null crash
                const domElement = app.view as unknown as HTMLCanvasElement;

                // Polyfill de isConnected para navegadores antiguos / entornos server-hybrid y PIXI 7.x bug
                if (domElement && typeof domElement.isConnected === 'undefined') {
                    Object.defineProperty(domElement, 'isConnected', { get: () => true });
                }

                // @ts-ignore - Patch nativo a PIXI.EventSystem.prototype.mapPositionToPoint para evitar el crash de TypeError `this.domElement.isConnected` si React desmonta
                if (!PIXI.EventSystem.prototype.mapPositionToPoint.__patched) {
                    // @ts-ignore
                    const originalMap = PIXI.EventSystem.prototype.mapPositionToPoint;
                    // @ts-ignore
                    PIXI.EventSystem.prototype.mapPositionToPoint = function (point, x, y) {
                        if (!this.domElement) return point; // Crash preventer
                        if (typeof this.domElement.isConnected === 'undefined') {
                            Object.defineProperty(this.domElement, 'isConnected', { get: () => true, configurable: true });
                        }
                        return originalMap.call(this, point, x, y);
                    };
                    // @ts-ignore
                    PIXI.EventSystem.prototype.mapPositionToPoint.__patched = true;
                }

                // Patch nativo a PIXI.EventSystem para evitar el crash de TypeError `this.domElement.isConnected` si se vuelve null internamente en React v18
                if (app.renderer && (app.renderer as any).events) {
                    const eventSystem = (app.renderer as any).events;
                    if (!eventSystem.domElement) {
                        eventSystem.setTargetElement(domElement);
                    }

                    // Asegurarnos que isConnected es truthy durante los ciclos de hidratación
                    if (eventSystem.domElement && eventSystem.domElement.isConnected === false) {
                        Object.defineProperty(eventSystem.domElement, 'isConnected', { get: () => true, configurable: true });
                    }
                }

                const vp = new Viewport({
                    screenWidth: window.innerWidth,
                    screenHeight: window.innerHeight,
                    worldWidth: 3000,
                    worldHeight: 3000,
                    // Usar la capa de eventos de PIXI v7 (renderer.events) 
                    // @ts-ignore
                    events: app.renderer.events,
                    // @ts-ignore
                    interaction: null, // Desactivar el interaction manager heredado de v6
                    // @ts-ignore
                    ticker: app.ticker,
                    // @ts-ignore
                    disableOnContextMenu: true,
                    // Pass the canvas element directly to the viewport so it knows where to listen
                    // @ts-ignore
                    divWheel: domElement
                });

                vp.drag().pinch().wheel().decelerate();
                vp.clampZoom({ minWidth: 100, maxWidth: 3000 });
                vp.moveCenter(1500, 1500);

                // Para React-Pixi y pixi-viewport compatibles, usamos PIXI puro
                // @ts-ignore - pixi.js namespace typing discrepancy
                const gridGraphics = new PIXI.Graphics();
                const gridSize = 10; // 10x10 px por bloque
                const worldSize = 3000;

                // En v7, lineStyle es un método de Graphics
                gridGraphics.lineStyle(1, 0x3f3f46, 0.5); // Grid sutil (zinc-700)

                // Optimizamos dibujando un grid de tamaño fijo central para la demo
                for (let i = 0; i <= worldSize; i += gridSize) {
                    gridGraphics.moveTo(i, 0);
                    gridGraphics.lineTo(i, worldSize);
                    gridGraphics.moveTo(0, i);
                    gridGraphics.lineTo(worldSize, i);
                }

                // @ts-ignore - pixi-viewport compatibility issue with strict typings
                vp.addChild(gridGraphics);

                // Capa de Píxeles (Sobre la grilla)
                // @ts-ignore
                const pixelsGraphics = new PIXI.Graphics();
                // @ts-ignore
                vp.addChild(pixelsGraphics);

                // Capa de Previsualización (Ghost Image)
                // @ts-ignore
                const ghostSprite = new PIXI.Sprite();
                ghostSprite.alpha = 0.6;
                ghostSprite.visible = false;
                // @ts-ignore
                vp.addChild(ghostSprite);

                // Capa de Highlight (Feedback de IA)
                // @ts-ignore
                const highlightGraphics = new PIXI.Graphics();
                // @ts-ignore
                vp.addChild(highlightGraphics);
                highlightGraphicsRef.current = highlightGraphics;

                // Texto informativo del Drop (Ghost Size Info)
                // @ts-ignore
                const ghostText = new PIXI.Text('', {
                    fontFamily: 'Arial',
                    fontSize: 12,
                    fill: 0xffffff,
                    stroke: 0x000000,
                    strokeThickness: 3,
                });
                ghostText.visible = false;
                // @ts-ignore
                vp.addChild(ghostText);

                // Para poder acceder globalmente en los sockets a este graphics layer
                // @ts-ignore
                const pixelsGraphicsRef = { current: pixelsGraphics };

                let ghostTextureUrl = "";
                let ghostScaleVal = -1;

                // Función que redibuja todos los píxeles de SQLite
                const drawPixels = (pixels: any[]) => {
                    pixelsGraphicsRef.current.clear();
                    pixels.forEach((p) => {
                        loadedPixelsRef.current.set(`${p.x}_${p.y}`, p);
                        let hexColor = parseInt(p.color.replace('#', '0x'));

                        // Sistema de visualización de Reservas
                        if (p.reservedBy && !p.pricePaid) {
                            if (p.reservedBy !== walletAddressRef.current) {
                                hexColor = 0x3f3f46; // Gris oscuro inactivo (zinc-700)
                            }
                        }

                        pixelsGraphicsRef.current.beginFill(hexColor);
                        pixelsGraphicsRef.current.drawRect(p.x * gridSize, p.y * gridSize, gridSize, gridSize);
                        pixelsGraphicsRef.current.endFill();
                    });
                };

                // Conexión Inteligente con Fallback (Protección Localhost Heurística)
                const isLocal = process.env.NODE_ENV === 'development';
                const primaryUrl = process.env.NEXT_PUBLIC_API_URL;

                const initializeCanvasData = async () => {
                    let activeUrl = primaryUrl;

                    if (!primaryUrl && isLocal) {
                        activeUrl = 'http://localhost:3001';
                    } else if (!primaryUrl) {
                        console.error("API URL undefined in Production");
                        return;
                    }

                    // Ping pre-flight
                    if (primaryUrl) {
                        try {
                            const ac = new AbortController();
                            const tid = setTimeout(() => ac.abort(), 20000);
                            const res = await fetch(`${primaryUrl}/api/pixels`, { method: 'GET', signal: ac.signal });
                            clearTimeout(tid);
                            if (!res.ok && res.status >= 500) throw new Error("Ngrok Server Error");

                            const data = await res.json();
                            if (Array.isArray(data)) drawPixels(data);
                        } catch (e) {
                            if (isLocal) {
                                console.warn("🔌 [Canvas] Primary URL unreachable, falling back to localhost...");
                                activeUrl = 'http://localhost:3001';
                                fetch(`${activeUrl}/api/pixels`)
                                    .then(res => res.json())
                                    .then(data => { if (Array.isArray(data)) drawPixels(data); })
                                    .catch(err => console.error("Error loading via fallback:", err));
                            }
                        }
                    } else if (isLocal) {
                        // Flujo normal puramente Localhost
                        fetch(`http://localhost:3001/api/pixels`)
                            .then(res => res.json())
                            .then(data => { if (Array.isArray(data)) drawPixels(data); })
                            .catch(err => console.error("Error loading pixels:", err));
                    }

                    // Una vez decidida la URL viva, conectamos el Socket definitive
                    const socket = io(activeUrl as string, { reconnectionAttempts: 3 });

                    socket.on('pixels_reserved', (reservedPixels: any[]) => {
                        reservedPixels.forEach(p => {
                            loadedPixelsRef.current.set(`${p.x}_${p.y}`, { ...loadedPixelsRef.current.get(`${p.x}_${p.y}`), ...p, reservedBy: p.reservedBy, reservedUntil: p.reservedUntil });
                        });
                        drawPixels(Array.from(loadedPixelsRef.current.values()));
                    });

                    socket.on('pixels_freed', (freedPixels: any[]) => {
                        freedPixels.forEach(p => {
                            const existing = loadedPixelsRef.current.get(`${p.x}_${p.y}`);
                            if (existing) {
                                existing.reservedBy = null;
                                existing.reservedUntil = null;
                                if (!existing.pricePaid) loadedPixelsRef.current.delete(`${p.x}_${p.y}`);
                            }
                        });
                        drawPixels(Array.from(loadedPixelsRef.current.values()));
                    });

                    socket.on('pixels_bought', (boughtPixels: any[]) => {
                        boughtPixels.forEach(p => {
                            loadedPixelsRef.current.set(`${p.x}_${p.y}`, { ...loadedPixelsRef.current.get(`${p.x}_${p.y}`), ...p, reservedBy: null, reservedUntil: null });
                        });
                        drawPixels(Array.from(loadedPixelsRef.current.values()));
                    });
                };

                initializeCanvasData();

                // Escucha de Mouse Hover para actualizar la Ghost Image y el Inpsector Tooltip
                // @ts-ignore
                vp.addListener('pointermove', (e: any) => {
                    const currentTool = activeToolRef.current;
                    const imgBase64 = pendingImageRef.current;

                    if (currentTool === 'image' && imgBase64) {
                        ghostSprite.visible = true;
                        ghostText.visible = true;

                        const currentScale = imageScaleRef.current || 50;

                        // Si la imagen o la escala ha cambiado, regeneramos la textura pixelada en memoria (con Aspect Ratio!)
                        if (ghostTextureUrl !== imgBase64 || ghostScaleVal !== currentScale) {
                            ghostTextureUrl = imgBase64;
                            ghostScaleVal = currentScale;
                            const image = new Image();
                            image.src = imgBase64;
                            image.onload = () => {
                                const MAX_DIMENSION = currentScale;
                                let maxW = image.width;
                                let maxH = image.height;

                                // Mantener el aspect ratio original escalando por el lado mayor hacia abajo si es necesario
                                if (maxW > MAX_DIMENSION || maxH > MAX_DIMENSION) {
                                    if (maxW >= maxH) {
                                        maxH = Math.round((maxH * MAX_DIMENSION) / maxW);
                                        maxW = MAX_DIMENSION;
                                    } else {
                                        maxW = Math.round((maxW * MAX_DIMENSION) / maxH);
                                        maxH = MAX_DIMENSION;
                                    }
                                }

                                // Para imágenes enanas (ej: 1x5) tampoco queremos que desaparezcan del UI ni que tengan 1 sub-pixel. 
                                maxW = Math.max(maxW, 1);
                                maxH = Math.max(maxH, 1);

                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = maxW;
                                tempCanvas.height = maxH;
                                const ctx = tempCanvas.getContext('2d');
                                if (ctx) {
                                    ctx.drawImage(image, 0, 0, maxW, maxH);
                                    // Desactivamos antialiasing para mantener estilo Pixel Art
                                    // @ts-ignore
                                    PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
                                    ghostSprite.texture = PIXI.Texture.from(tempCanvas);
                                    ghostSprite.width = maxW * gridSize;
                                    ghostSprite.height = maxH * gridSize;

                                    // Guardar info extra para calculos de Grid Centrado
                                    ghostSprite.anchor.set(0.5, 0.5); // Volvemos a centrar al ratón
                                    ghostText.text = `${maxW}x${maxH} pixels`;
                                    ghostText.anchor.set(0.5, 1);
                                }
                            };
                        }

                        if (!isStagedRef.current) {
                            // Mapeo Snap-To-Grid de Pixi (Solo si no está staged/congelada para confirmar)
                            // @ts-ignore
                            const worldPos = vp.toWorld(e.global.x, e.global.y);

                            const gridX = Math.floor(worldPos.x / gridSize);
                            const gridY = Math.floor(worldPos.y / gridSize);

                            // Como el ghostSprite tiene anchor(0.5, 0.5), snapX y snapY indican el CENTRO REAL
                            const snapX = gridX * gridSize + (gridSize / 2);
                            const snapY = gridY * gridSize + (gridSize / 2);

                            ghostSprite.x = snapX;
                            ghostSprite.y = snapY;

                            ghostText.x = snapX;
                            ghostText.y = snapY - (ghostSprite.height / 2) - 10;
                        }

                    } else {
                        ghostSprite.visible = false;
                        ghostText.visible = false;
                    }

                    // Lógica para detectar Hover de Píxel Real en todo momento
                    if (onHoverPixelRef.current) {
                        // @ts-ignore
                        const worldPos = vp.toWorld(e.global.x, e.global.y);
                        const gridX = Math.floor(worldPos.x / gridSize);
                        const gridY = Math.floor(worldPos.y / gridSize);

                        const pixelKey = `${gridX}_${gridY}`;
                        const pData = loadedPixelsRef.current.get(pixelKey);

                        if (pData) {
                            const screenX = e.global.x;
                            const screenY = e.global.y;

                            onHoverPixelRef.current({
                                x: gridX,
                                y: gridY,
                                color: pData.color,
                                ownerWallet: pData.ownerWallet,
                                screenX: screenX,
                                screenY: screenY,
                                pricePaid: pData.pricePaid || 1
                            });
                        } else {
                            onHoverPixelRef.current(null);
                        }
                    }
                });

                // Interacción de Pintar a click de ratón
                // @ts-ignore - pixi-viewport on parameter types
                vp.addListener('clicked', (e: any) => {
                    const currentTool = activeToolRef.current;
                    if (currentTool !== 'paint' && currentTool !== 'image') return; // Ignorar select o chat clicks para dibujo

                    const worldPos = e.world;
                    const gridX = Math.floor(worldPos.x / gridSize);
                    const gridY = Math.floor(worldPos.y / gridSize);

                    if (gridX < 0 || gridY < 0 || gridX > (worldSize / gridSize) || gridY > (worldSize / gridSize)) return;

                    const currentWallet = walletAddressRef.current;
                    if (!currentWallet) {
                        if (connected) {
                            toast.loading("Verifying wallet connection... please try again in a second.", { duration: 2000 });
                        } else {
                            toast.error("Please connect your Solana wallet to interact with the canvas.");
                        }
                        return;
                    }

                    if (currentTool === 'paint') {
                        const color = selectedColorRef.current;

                        // Verificación de ocupación / reserva antes de iniciar flujo de compra
                        const pData = loadedPixelsRef.current.get(`${gridX}_${gridY}`);
                        if (pData && (pData.pricePaid > 0 || (pData.reservedBy && pData.reservedBy !== currentWallet))) {
                            toast.error("This pixel is occupied or reserved by someone else.");
                            return;
                        }

                        // NO hacemos rendering optimista — el pixel solo se pinta cuando se confirma el pago
                        // vía el evento WebSocket 'pixels_bought'
                        const pixelData = { x: gridX, y: gridY, color, walletAddress: currentWallet };
                        if (onImagePlaced) {
                            onImagePlaced({ x: gridX, y: gridY, count: 1, pixels: [pixelData] });
                        }

                    } else if (currentTool === 'image' && pendingImageRef.current) {
                        // Estampado bulk de imagen respetando Aspect Ratio y Offsets de centrado (como el preview)
                        const imgBase64 = pendingImageRef.current;
                        const currentScale = imageScaleRef.current || 50;
                        const img = new Image();

                        img.onload = () => {
                            const MAX_DIMENSION = currentScale;
                            let maxW = img.width;
                            let maxH = img.height;

                            if (maxW > MAX_DIMENSION || maxH > MAX_DIMENSION) {
                                if (maxW >= maxH) {
                                    maxH = Math.round((maxH * MAX_DIMENSION) / maxW);
                                    maxW = MAX_DIMENSION;
                                } else {
                                    maxW = Math.round((maxW * MAX_DIMENSION) / maxH);
                                    maxH = MAX_DIMENSION;
                                }
                            }

                            maxW = Math.max(maxW, 1);
                            maxH = Math.max(maxH, 1);

                            const tempCanvas = document.createElement('canvas');
                            tempCanvas.width = maxW;
                            tempCanvas.height = maxH;
                            const ctx = tempCanvas.getContext('2d');
                            if (!ctx) return;

                            ctx.drawImage(img, 0, 0, maxW, maxH);
                            const imageData = ctx.getImageData(0, 0, maxW, maxH).data;

                            const pixelsToSave = [];

                            // Calcula el Grid Center Virtual idéntico al ghostSprite.anchor(0.5, 0.5)
                            const offsetX = Math.floor(maxW / 2);
                            const offsetY = Math.floor(maxH / 2);

                            // Calculamos las coordenadas Top-Left donde debe empezar estamparse la imagen respecto al click
                            const startGridX = gridX - offsetX;
                            const startGridY = gridY - offsetY;

                            for (let y = 0; y < maxH; y++) {
                                for (let x = 0; x < maxW; x++) {
                                    const index = (y * maxW + x) * 4;
                                    const r = imageData[index];
                                    const g = imageData[index + 1];
                                    const b = imageData[index + 2];
                                    const a = imageData[index + 3];

                                    // Transparencias Alpha threshold
                                    if (a < 50) continue;

                                    const hex = "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);

                                    // Translación final absoluta en el lienzo
                                    const finalX = startGridX + x;
                                    const finalY = startGridY + y;

                                    if (finalX < 0 || finalY < 0 || finalX > (worldSize / gridSize) || finalY > (worldSize / gridSize)) continue;

                                    // Removido Render optimista aquí. El Ghost Sprite hace el preview visual, y los píxeles reales se renderizan tras confirmación del server.

                                    pixelsToSave.push({ x: finalX, y: finalY, color: hex, walletAddress: currentWallet });
                                }
                            }

                            console.log(`[UI] Group of ${pixelsToSave.length} pixels placed tentatively. Preparing AI checkout...`);

                            if (onImagePlaced) {
                                onImagePlaced({
                                    x: startGridX,
                                    y: startGridY,
                                    count: pixelsToSave.length,
                                    pixels: pixelsToSave,
                                    width: maxW,
                                    height: maxH
                                });
                            }
                        };
                        img.src = imgBase64;
                    }
                });

                setViewport(vp);
                // @ts-ignore - pixi-viewport compatibility issue with strict typings
                app.stage.addChild(vp);
            }}
        >
        </Stage>
    );
};

import { useWallet } from '@solana/wallet-adapter-react';

export default function PixelCanvas({ activeTool, selectedColor, pendingImage, imageScale, chatOpen, highlightPosition, isStaged, onImagePlaced }: PixelCanvasProps) {
    // Next dynamic con {ssr:false} renderiza client-side directamente
    const { publicKey, connected } = useWallet();

    const walletString = publicKey ? publicKey.toString() : undefined;
    const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, color: string, ownerWallet: string, screenX: number, screenY: number, pricePaid: number } | null>(null);

    return (
        <div className="w-full h-full overflow-hidden absolute inset-0 z-0 select-none">
            <ViewportComponent walletAddress={walletString} connected={connected} activeTool={activeTool} selectedColor={selectedColor} pendingImage={pendingImage} imageScale={imageScale} chatOpen={chatOpen} highlightPosition={highlightPosition} isStaged={isStaged} onImagePlaced={onImagePlaced} onHoverPixel={setHoverInfo} />

            {/* Tooltip Inspector */}
            {hoverInfo && activeTool === 'select' && (
                <div
                    className="absolute z-50 pointer-events-none bg-zinc-950/95 border border-zinc-700/80 p-3 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md text-white text-xs transform -translate-x-1/2 -translate-y-[calc(100%+15px)] flex flex-col gap-2 min-w-[200px]"
                    style={{ left: hoverInfo.screenX, top: hoverInfo.screenY }}
                >
                    <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                        <span className="font-bold text-zinc-100 flex items-center gap-1">
                            <div className="w-3 h-3 rounded-sm border border-zinc-600 shadow-inner" style={{ backgroundColor: hoverInfo.color }}></div>
                            Pixel ({hoverInfo.x}, {hoverInfo.y})
                        </span>
                        <span className="text-[9px] text-zinc-500 font-mono tracking-widest ml-2 uppercase">Owned</span>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-1">
                        <div className="flex justify-between items-center">
                            <span className="text-zinc-500 font-medium">Owner</span>
                            <span className="text-blue-400 font-mono bg-blue-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                                {hoverInfo.ownerWallet.slice(0, 4)}...{hoverInfo.ownerWallet.slice(-4)}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-zinc-500 font-medium">Original Price</span>
                            <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                                {hoverInfo.pricePaid} SOL
                            </span>
                        </div>
                    </div>

                    {/* Flechitas del tooltip para apuntar al píxel */}
                    <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-full border-[6px] border-transparent border-t-zinc-700/80 z-[-1]"></div>
                    <div className="absolute left-1/2 bottom-[1px] transform -translate-x-1/2 translate-y-full border-[5px] border-transparent border-t-zinc-950/95"></div>
                </div>
            )}
        </div>
    );
}
