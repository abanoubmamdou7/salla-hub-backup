import 'dotenv/config';
import pkg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg2 from '@prisma/client';
const { PrismaClient } = pkg2;

const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;
