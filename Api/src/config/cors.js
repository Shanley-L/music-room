export function resolveCorsOrigin() {
  return process.env.CORS_ORIGIN || '*';
}

export function toSocketIoOrigin(origin) {
  return origin === '*' ? true : origin;
}
