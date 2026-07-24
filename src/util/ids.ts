import { ID_ALPHABET } from "../constants";

let lastSeed = Date.now();

export function generateRandomSuffix(): string {
  const array = new Uint8Array(8);
  if (typeof activeWindow !== "undefined" && activeWindow.crypto && activeWindow.crypto.getRandomValues) {
    activeWindow.crypto.getRandomValues(array);
  } else {
    // Fallback for older test environments without web crypto
    let seed = (lastSeed + 1) ^ Date.now();
    lastSeed = seed;
    for (let i = 0; i < 8; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      array[i] = seed & 0xff;
    }
  }
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    const val = array[i]! % 32;
    suffix += ID_ALPHABET[val]!;
  }
  return suffix;
}

export function generateRecordId(type: "floor" | "reply", date: Date): string {
  const pad = (num: number) => String(num).padStart(2, "0");
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  const datePart = `${year}${month}${day}`;
  const timePart = `${hours}${minutes}${seconds}`;
  const suffix = generateRandomSuffix();

  return `${type}-${datePart}-${timePart}-${suffix}`;
}

export function isValidRecordId(id: string): boolean {
  const regex = /^(floor|reply)-([0-9]{8})-([0-9]{6})-([0123456789abcdefghjkmnpqrstvwxyz]{8})$/;
  return regex.test(id);
}
