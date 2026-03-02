import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const pixels = await prisma.pixel.findMany({
            select: { x: true, y: true, color: true, ownerWallet: true }
        });
        return NextResponse.json(pixels);
    } catch (error) {
        console.error('Error fetching pixels:', error);
        return NextResponse.json({ error: 'Failed to fetch pixels' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { x, y, color, walletAddress } = await req.json();

        if (x === undefined || y === undefined || !color || !walletAddress) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // Upsert para actualizar o crear el pixel en la cuadrícula
        const pixel = await prisma.pixel.upsert({
            where: { id: `${x}_${y}` },
            update: { color, ownerWallet: walletAddress },
            create: {
                id: `${x}_${y}`,
                x,
                y,
                color,
                ownerWallet: walletAddress,
                pricePaid: 1, // default $1 para la demo
                isForSale: false,
            },
        });

        return NextResponse.json({ success: true, pixel }, { status: 201 });
    } catch (error) {
        console.error('Error saving pixel:', error);
        return NextResponse.json({ error: 'Failed to save pixel' }, { status: 500 });
    }
}
