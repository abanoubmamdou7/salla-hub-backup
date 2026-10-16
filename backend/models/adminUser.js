import prisma from '../config/prisma.js';

function toInt(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) throw new TypeError(`Invalid id: ${id}`);
  return n;
}

export async function getAdminByEmail(email) {
  return prisma.adminUser.findUnique({ where: { email: String(email).trim().toLowerCase() } });
}

export async function getAdminById(id) {
  return prisma.adminUser.findUnique({ where: { id: toInt(id) } });
}

export async function countAdmins() {
  return prisma.adminUser.count();
}

export async function createAdmin({ email, passwordHash }) {
  return prisma.adminUser.create({
    data: { email: String(email).trim().toLowerCase(), passwordHash },
  });
}

export async function updateAdmin(id, data) {
  return prisma.adminUser.update({ where: { id: toInt(id) }, data });
}
