import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";

// 128 bits aleatórios em base64url (22 caracteres). Formato validado para
// rejeitar lixo antes de ir ao banco.
const tokenParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

export async function receiptRoutes(app: FastifyInstance) {
  // Público e compartilhável: o token aleatório É a credencial (quem tem o link
  // vê o comprovante). Mostra o snapshot do lote guardado no banco, então
  // funciona com a API externa fora do ar. Identifica o vencedor só por alias.
  app.get("/receipts/:token", async (request) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const receipt = await prisma.receipt.findUnique({
      where: { publicToken: token },
      include: { lot: true, winner: { select: { publicAlias: true } } },
    });
    if (!receipt) throw new AppError("NOT_FOUND", "Receipt not found");

    return {
      receipt: {
        token: receipt.publicToken,
        issuedAt: receipt.issuedAt.toISOString(),
        amountCents: Number(receipt.amountCents),
        winnerAlias: receipt.winner.publicAlias,
        seal: { count: receipt.sealCount, hash: receipt.sealHash },
        lot: {
          id: receipt.lot.id,
          title: receipt.lot.title,
          imageUrl: receipt.lot.imageUrl,
          attributes: receipt.lot.attributes,
          closedAt: receipt.lot.closedAt?.toISOString() ?? null,
          bidCount: receipt.lot.bidCount,
        },
      },
      serverNow: new Date().toISOString(),
    };
  });
}
