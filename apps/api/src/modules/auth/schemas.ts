import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(2).max(80),
  role: z.enum(["auctioneer", "bidder"]),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Nome de exibição: só a própria pessoa o vê (o que é público é o alias, que não muda).
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Teto de 72: o bcrypt só considera os primeiros 72 bytes, então uma senha maior daria
// a falsa impressão de que tudo o que passa disso importa.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "Password must be at least 8 characters").max(72),
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
