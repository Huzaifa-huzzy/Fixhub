export function isValidEmail(value: string) {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidText(value: string, minLength: number, maxLength: number) {
  const text = value.trim();
  return text.length >= minLength
    && text.length <= maxLength
    && !/[\u0000-\u001F\u007F]/.test(text);
}

export function isValidDecimal(
  value: string,
  min: number,
  max: number,
  decimalPlaces = 2,
) {
  const pattern = decimalPlaces > 0
    ? new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`)
    : /^\d+$/;
  if (!pattern.test(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

export function filterTextInput(value: string, maxLength: number, allowNewLines = false) {
  const normalized = value.replace(/\r\n?/g, '\n');
  const pattern = allowNewLines
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
    : /[\u0000-\u001F\u007F]/g;
  return normalized.replace(pattern, '').slice(0, maxLength);
}

function normalizeDigits(value: string) {
  return value
    .replace(/[٠-٩۰-۹]/g, (digit) => {
      const codePoint = digit.codePointAt(0) ?? 0;
      const zero = codePoint >= 0x06F0 ? 0x06F0 : 0x0660;
      return String(codePoint - zero);
    })
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

export function filterDecimalInput(value: string, decimalPlaces = 2) {
  const cleaned = normalizeDigits(value).replace(/[^\d.]/g, '');
  const decimalIndex = cleaned.indexOf('.');
  if (decimalIndex === -1) return cleaned;
  const whole = cleaned.slice(0, decimalIndex);
  const fraction = cleaned.slice(decimalIndex + 1).replace(/\./g, '').slice(0, decimalPlaces);
  return `${whole || '0'}.${fraction}`;
}

export function filterIntegerInput(value: string) {
  return normalizeDigits(value).replace(/\D/g, '');
}

export function isValidPakistanPhone(value: string) {
  return /^0\d{10}$/.test(value);
}

export function toPakistanInternationalPhone(value: string) {
  return `+92${value.slice(1)}`;
}

export function toPakistanLocalPhone(value: string) {
  return /^\+92[3-9]\d{9}$/.test(value) ? `0${value.slice(3)}` : value;
}
