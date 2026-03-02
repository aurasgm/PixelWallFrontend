import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey } from '@solana/web3.js';

const prisma = new PrismaClient();
const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");

export async function POST(req: NextRequest) {
    try {
        const { signature, pixels, walletAddress, amount } = await req.json();

        if (!signature || !pixels || !walletAddress) {
            return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
        }

        // 1. (Opcional por ahora) Validar On-Chain la Tx
        // Para que esto fuera 100% seguro contra Hackers, aquí haríamos:
        // const tx = await connection.getTransaction(signature);
        // Validaríamos que "tx" contuviese en sus *instructions* el pago hacia nuestra Treasury Wallet por la cantidad "amount". 
        // Asumiendo que ha pasado la validación criptográfica (O es Devnet y la falseamos):
        const isValid = true;

        if (!isValid) {
            return NextResponse.json({ error: "Invalid Transaction Signature" }, { status: 403 });
        }

        // 2. Transacción de Base de Datos para registrar todos los píxeles pagados y actualizar `isForSale`
        // Usamos prisma transaction para hacerlo todo de golpe (Bulk Insert o Update)
        const dbOperations = pixels.map((p: any) => {
            const id = `${p.x},${p.y}`;
            return prisma.pixel.upsert({
                where: { id },
                update: {
                    color: p.color,
                    ownerWallet: walletAddress,
                    pricePaid: amount / pixels.length, // Split the cost
                    isForSale: false,
                    updatedAt: new Date()
                },
                create: {
                    id,
                    x: p.x,
                    y: p.y,
                    color: p.color,
                    ownerWallet: walletAddress,
                    pricePaid: amount / pixels.length,
                    isForSale: false
                }
            });
        });

        await prisma.$transaction(dbOperations);

        // 3. Opcional: Registrar la compra "Macro" en una tabla de Transacciones Históricas
        await prisma.transaction.create({
            data: {
                buyerWallet: walletAddress,
                sellerWallet: "TREASURY", // Por ahora todo se lo compramos a la casa
                amount: amount,
                pixels: JSON.stringify(pixels.map((p: any) => ({ x: p.x, y: p.y })))
            }
        });

        return NextResponse.json({ success: true, pixelsSaved: pixels.length });

    } catch (e: any) {
        console.error("Failed to process payment:", e);
        return NextResponse.json({ error: "Server Error", details: e.message }, { status: 500 });
    }
}
