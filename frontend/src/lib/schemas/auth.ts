import { z } from "zod";

// Length only, never composition: the server accepts any 8 to 128 characters.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const username = z.string().trim().min(1, "Enter a username").max(64, "Use at most 64 characters");
const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export const setupSchema = z
  .object({ username, password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords don't match",
  });
