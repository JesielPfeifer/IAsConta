import { Request, Response, NextFunction } from "express";

const BOT_API_KEY = process.env.BOT_API_KEY;
if (!BOT_API_KEY) {
  console.error("[FATAL] BOT_API_KEY env var is required");
  process.exit(1);
}

export function botAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers["x-bot-api-key"] as string | undefined;

  if (!apiKey || apiKey !== BOT_API_KEY) {
    res.status(401).json({ error: "Bot API key invalida" });
    return;
  }

  next();
}
