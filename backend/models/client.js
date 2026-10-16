
import prisma from '../config/prisma.js';

function toInt(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) throw new TypeError(`Invalid id: ${id}`);
  return n;
}

export async function listClients() {
  return prisma.client.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function getClientById(id) {
  return prisma.client.findUnique({ where: { id: toInt(id) } });
}

export async function getClientBySlug(slug) {
  return prisma.client.findUnique({ where: { slug } });
}

export async function createClient(data) {
  return prisma.client.create({ data });
}

export async function updateClient(id, data) {
  return prisma.client.update({ where: { id: toInt(id) }, data });
}

export async function deleteClient(id) {
  return prisma.client.delete({ where: { id: toInt(id) } });
}

export async function getClientStores(clientId) {
  return prisma.sallaToken.findMany({
    where:   { clientId: toInt(clientId) },
    select:  { storeId: true, expiresAt: true, expiresIn: true, updatedAt: true, createdAt: true },
    orderBy: { updatedAt: 'desc' },
  });
}
