import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { sendPasswordReset, sendPartnerInvite } from "../services/email.js";

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-random-secret";

const DEFAULT_CATEGORIES = [
  "Alimentação",
  "Transporte",
  "Moradia",
  "Saúde",
  "Educação",
  "Lazer",
  "Assinaturas",
  "Vestuário",
  "Salário",
  "Freelance",
  "Investimentos",
  "Beleza",
  "Veículo",
  "Financiamento",
  "Telefonia",
  "Compras",
  "Serviços",
  "Gasolina",
  "Mercado",
  "Uber/transporte",
  "IFood/restaurante",
  "Despesas eventuais",
  "Eletrônicos",
  "Presentes",
  "Roupa",
  "Outros",
];

function generateToken(user: {
  id: string;
  email: string;
  name: string;
  salary: number | null;
  partnerId: string | null;
}): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      salary: user.salary,
      partnerId: user.partnerId,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

const registerSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  name: z.string().min(2, "Nome obrigatório"),
  salary: z.number().positive().optional(),
  partnerToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

const invitePartnerSchema = z.object({
  email: z.string().email("Email inválido"),
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      res.status(409).json({ error: "Email já cadastrado" });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    let partnerId: string | null = null;
    if (data.partnerToken) {
      try {
        const partnerPayload = jwt.verify(data.partnerToken, JWT_SECRET) as {
          partnerId: string;
          type: string;
        };
        if (partnerPayload.type !== "partner-invite") {
          res.status(400).json({ error: "Token de convite inválido" });
          return;
        }
        const partner = await prisma.user.findUnique({
          where: { id: partnerPayload.partnerId },
        });
        if (!partner) {
          res.status(404).json({ error: "Parceiro não encontrado" });
          return;
        }
        if (partner.partnerId) {
          res.status(409).json({ error: "Parceiro já possui um casal vinculado" });
          return;
        }
        partnerId = partner.id;
      } catch {
        res.status(400).json({ error: "Token de convite inválido ou expirado" });
        return;
      }
    }

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        salary: data.salary ?? null,
        partnerId,
      },
    });

    if (partnerId) {
      await prisma.user.update({
        where: { id: partnerId },
        data: { partnerId: user.id },
      });
    }

    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((cat) => ({
        name: cat,
        isDefault: true,
        userId: user.id,
      })),
    });

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      salary: user.salary,
      partnerId: user.partnerId,
    });

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, salary: user.salary, partnerId: user.partnerId } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      res.status(401).json({ error: "Email ou senha inválidos" });
      return;
    }

    const valid = await bcrypt.compare(data.password, user.password);
    if (!valid) {
      res.status(401).json({ error: "Email ou senha inválidos" });
      return;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      salary: user.salary,
      partnerId: user.partnerId,
    });

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, salary: user.salary, partnerId: user.partnerId } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      res.json({ message: "Se o email existir, um token será enviado" });
      return;
    }

    const resetToken = jwt.sign(
      { id: user.id, type: "password-reset" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    sendPasswordReset(user.email, resetToken).catch(() => {});

    res.json({ message: "Se o email existir, um token será enviado" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const data = resetPasswordSchema.parse(req.body);

    let payload: { id: string; type: string };
    try {
      payload = jwt.verify(data.token, JWT_SECRET) as { id: string; type: string };
    } catch {
      res.status(400).json({ error: "Token inválido ou expirado" });
      return;
    }

    if (payload.type !== "password-reset") {
      res.status(400).json({ error: "Token inválido" });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    await prisma.user.update({
      where: { id: payload.id },
      data: { password: hashedPassword },
    });

    res.json({ message: "Senha redefinida com sucesso" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post(
  "/invite-partner",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const data = invitePartnerSchema.parse(req.body);
      const user = req.user!;

      if (user.partnerId) {
        res.status(409).json({ error: "Você já possui um parceiro vinculado" });
        return;
      }

      const inviteToken = jwt.sign(
        { partnerId: user.id, type: "partner-invite" },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      sendPartnerInvite(data.email, user.name, inviteToken).catch(() => {});

      res.json({ message: "Convite enviado com sucesso" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Dados inválidos", details: err.errors });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Erro interno" });
    }
  }
);

export default router;
