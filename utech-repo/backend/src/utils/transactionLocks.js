'use strict';

// InnoDB row locks serialize multi-step document state changes. Call within an
// interactive ReadCommitted transaction, then re-read the document/lines.
async function lockChallan(tx, id) {
  await tx.$queryRaw`SELECT \`id\` FROM \`JobworkChallan\` WHERE \`id\` = ${id} FOR UPDATE`;
}

async function lockVendorWorkOrder(tx, id) {
  await tx.$queryRaw`SELECT \`id\` FROM \`VendorWorkOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
}

async function lockJobcard(tx, id) {
  await tx.$queryRaw`SELECT \`id\` FROM \`Jobcard\` WHERE \`id\` = ${id} FOR UPDATE`;
}

module.exports = { lockChallan, lockVendorWorkOrder, lockJobcard };
