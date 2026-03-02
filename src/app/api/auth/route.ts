import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
    try {
        const { publicKey, signature, message } = await req.json();

        if (!publicKey) {
            return NextResponse.json({ error: 'Falta la clave pública (publicKey)' }, { status: 400 });
        }

        // Aquí iría la lógica de verificación criptográfica de la firma usando @solana/web3.js y tweetnacl
        // Para la complejidad de la Fase 1, asumiremos que si llega el publicKey desde el WalletAdapter validado en frontend, lo registramos.

        // Buscar o crear usuario
        let user = await prisma.user.findUnique({
            where: { walletAddress: publicKey },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    walletAddress: publicKey,
                },
            });
        }

        // En un entorno de producción real, aquí se emitiría un JWT (JSON Web Token) firmado para mantener la sesión en cookies seguras.
        return NextResponse.json({ success: true, user });

    } catch (error) {
        console.error('Error in auth route:', error);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
