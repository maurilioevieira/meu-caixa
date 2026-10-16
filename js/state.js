// =====================================================================
//  state.js — Estado global simples, compartilhado entre as páginas
// ---------------------------------------------------------------------
//  Fica num arquivo próprio (e não no app.js) para que as páginas possam
//  importá-lo sem criar dependência circular com o app.js.
// =====================================================================

export const state = {
  household: null   // { householdId, householdName, me, members }
};
