import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Instanciamos el SDK de Gemini. Toma la KEY de las variables de entorno locales
const ai = new GoogleGenAI({});

// System Prompt del Agente
const SYSTEM_PROMPT = `Eres el "Agente" de AgentWall, un vendedor inteligente de un muro digital de píxeles (similar a The Million Dollar Homepage, pero dinámico y conectado a Web3/Solana).
Reglas:
1. Actúas como un asesor inmobiliario. Eres carismático, persuasivo y entiendes de mercados cripto/NFT.
2. Si el usuario pregunta "dónde comprar", le recomiendas zonas vacías (más baratas) o zonas "Premium" (al lado de gente famosa, pero más caras).
3. Si el usuario selecciona unos píxeles (coordenadas X,Y), debes negociar el precio. Si está vacío y lejos del centro, es barato (ej. $1/píxel). Si está en el centro o cerca de "Influencers", multiplicas el precio.
4. Tienes la capacidad de sugerir acciones (comprar/vender). Debes generar botones de acción incluyéndolos en tu respuesta con este formato exacto:
   - Para comprar: "[CLICK_BUY: cantidad_pixeles, X, Y, precio_total]" (ejemplo: [CLICK_BUY: 100, 45, 90, 50])
   - Para vender: "[CLICK_SELL: cantidad_pixeles, X, Y, precio_total]" (ejemplo: [CLICK_SELL: 100, 10, 20, 500])
   El frontend leerá estas etiquetas ocultas y renderizará botones interactivos hermosos, no debes explicarle este formato al usuario, solo usalo al final de tu frase sugerida.
   
Contesta de manera amigable, conversacional y en inglés, según las preferencias del usuario.`;

export async function POST(req: Request) {
    try {
        const { message, history, context } = await req.json();

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        // Convertir el historial al formato que entiende el nuevo SDK genai (Content objects)
        const formattedHistory = (history || []).map((msg: { role: string; parts: { text: string }[] }) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.parts[0].text }],
        }));

        // Construir contexto dinámico inyectado en el System Prompt
        const DYNAMIC_PROMPT = `${SYSTEM_PROMPT}\n\n[SYSTEM REAL-TIME CONTEXT DATA]\n- User Wallet Connected: ${context?.walletAddress || 'Not connected'}\n- Current Tool Selected: ${context?.activeTool || 'None'}\n- Current Color Selected: ${context?.selectedColor || 'None'}`;

        // Construimos el array completo de mensajes
        const fullConversation = [
            ...formattedHistory,
            { role: 'user', parts: [{ text: message }] }
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: fullConversation,
            config: {
                systemInstruction: DYNAMIC_PROMPT,
            }
        });

        return NextResponse.json({
            text: response.text,
        });

    } catch (error) {
        console.error('Error generating AI response:', error);
        return NextResponse.json({ error: 'Error processing AI request' }, { status: 500 });
    }
}
