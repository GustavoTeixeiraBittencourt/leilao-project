// Validação do formulário de Perfil (fora do componente para testar sem React). Espelha o
// que a API exige: nome de 2 a 80 caracteres (aparado) e senha nova de 8 a 72, diferente da
// atual. O servidor valida de novo; aqui é só para a pessoa ver o erro antes de enviar.

export const MIN_NAME = 2;
export const MAX_NAME = 80;
export const MIN_PASSWORD = 8;
// O bcrypt só considera os primeiros 72 bytes; a API recusa acima disso.
export const MAX_PASSWORD = 72;

// Devolve o nome já aparado, ou o erro.
export function checkDisplayName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim();
  if (name.length < MIN_NAME) return { ok: false, error: `Use pelo menos ${MIN_NAME} caracteres.` };
  if (name.length > MAX_NAME) return { ok: false, error: `Use no máximo ${MAX_NAME} caracteres.` };
  return { ok: true, name };
}

export type PasswordForm = { current: string; next: string; confirm: string };
export type PasswordErrors = Partial<Record<keyof PasswordForm, string>>;

export function checkPasswordChange(form: PasswordForm): PasswordErrors {
  const errors: PasswordErrors = {};
  if (form.current === "") errors.current = "Informe a senha atual.";

  if (form.next.length < MIN_PASSWORD) errors.next = `A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  // Conta em bytes (UTF-8), como o bcrypt: um acento ocupa 2 bytes.
  else if (new TextEncoder().encode(form.next).length > MAX_PASSWORD) {
    errors.next = `A nova senha pode ter no máximo ${MAX_PASSWORD} bytes (cerca de ${MAX_PASSWORD} caracteres sem acento).`;
  } else if (form.next === form.current) errors.next = "A nova senha precisa ser diferente da atual.";

  if (!errors.next && form.confirm !== form.next) errors.confirm = "A confirmação não é igual à nova senha.";
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some(Boolean);
}
