import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

const createCategorySchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional().nullable(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().optional().nullable(),
});

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const categories = await prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
    });

    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = createCategorySchema.parse(req.body);

    const category = await prisma.category.create({
      data: {
        name: data.name,
        icon: data.icon ?? null,
        userId: user.id,
      },
    });

    res.status(201).json(category);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const data = updateCategorySchema.parse(req.body);

    const existing = await prisma.category.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada" });
      return;
    }

    const category = await prisma.category.update({
      where: { id: id as string },
      data: data as any,
    });

    res.json(category);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const existing = await prisma.category.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada" });
      return;
    }

    if (existing.isDefault) {
      res.status(403).json({ error: "Categorias padrão não podem ser removidas" });
      return;
    }

    await prisma.category.delete({ where: { id: id as string } });

    res.json({ message: "Categoria removida" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
