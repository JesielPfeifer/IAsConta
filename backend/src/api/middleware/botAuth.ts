import { Request, Response, NextFunction } from "express";

const BOT_API_KEY = process.env.BOT_API_KEY || "change-me-bot-key";

export function botAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers["x-bot-api-key"] as string | undefined;

  if (!apiKey || apiKey !== BOT_API_KEY) {
    res.status(401).json({ error: "Bot API key inválida" });
    return;
  }

  next();
}
