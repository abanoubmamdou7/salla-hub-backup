import prisma from '../config/prisma.js';

export async function findTokenByStoreId(storeId) {
  return prisma.sallaToken.findUnique({ where: { storeId } });
}

export async function insertToken({ storeId, clientId, accessToken, refreshToken, expiresIn, expiresAt }) {
  return prisma.sallaToken.create({
    data: { storeId, clientId: clientId ?? null, accessToken, refreshToken, expiresIn, expiresAt },
  });
}

export async function updateToken({ storeId, accessToken, refreshToken, expiresIn, expiresAt }) {
  return prisma.sallaToken.update({
    where: { storeId },
    data:  { accessToken, refreshToken, expiresIn, expiresAt },
  });
}

export async function upsertToken({ storeId, clientId, accessToken, refreshToken, expiresIn, expiresAt }) {
  return prisma.sallaToken.upsert({
    where:  { storeId },
    create: { storeId, clientId: clientId ?? null, accessToken, refreshToken, expiresIn, expiresAt },
    update: { accessToken, refreshToken, expiresIn, expiresAt, ...(clientId ? { clientId } : {}) },
  });
}
