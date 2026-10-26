import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // O navegador envia a origem SEM barra final e o CORS compara o texto exato;
  // colar "https://app.vercel.app/" no painel bloquearia tudo. Normaliza aqui.
  CORS_ORIGIN: z
    .string()
    .trim()
    .min(1, "CORS_ORIGIN is required")
    .transform((origin) => origin.replace(/\/+$/, "")),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  AUDIT_SECRET: z.string().min(16, "AUDIT_SECRET must be at least 16 characters"),
  // Intervalo do worker de encerramento (ms). 1–2s pelo CLAUDE.md.
  WORKER_INTERVAL_MS: z.coerce.number().int().min(200).default(1500),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
