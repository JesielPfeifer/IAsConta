import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma único do processo.
 *
 * Cada `new PrismaClient()` abre o próprio pool de conexões (5 por padrão).
 * Instanciar um cliente por requisição — como o handler de webhook fazia —
 * esgota o pool quando os eventos chegam em rajada e o sync da Pluggy também
 * está usando conexões, resultando em:
 *
 *   PrismaClientInitializationError: Timed out fetching a new connection from
 *   the connection pool (Current connection pool timeout: 10, connection
 *   limit: 5)
 *
 * Módulos devem importar esta instância em vez de criar a sua.
 */
export const prisma = new PrismaClient();

export default prisma;
