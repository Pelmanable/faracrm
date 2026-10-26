export function htmlToText(html: string): string {
  const element = document.createElement('div');
  element.innerHTML = html;
  element.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  element
    .querySelectorAll('p, li, blockquote, h1, h2, h3, pre')
    .forEach(node => {
      node.append('\n');
    });
  return (element.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function textToHtml(text: string): string {
  if (!text) return '';
  const element = document.createElement('div');
  element.textContent = text;
  return `<p>${element.innerHTML.replace(/\n/g, '<br>')}</p>`;
}

export function signatureHasText(body: string, isEmail: boolean): boolean {
  return (isEmail ? htmlToText(body) : body).trim().length > 0;
}

export function composeSignedMessage(
  message: string,
  signature: string | null,
  isEmail: boolean,
): string {
  const main = signatureHasText(message, isEmail) ? message.trim() : '';
  const tail =
    signature && signatureHasText(signature, isEmail) ? signature.trim() : '';
  if (!tail) return main;
  if (!main) return tail;
  return isEmail ? `${main}<p><br></p>${tail}` : `${main}\n\n${tail}`;
}
