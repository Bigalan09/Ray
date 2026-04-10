export async function fetchWithRetry(
  request: any,
  method: "get" | "post" | "put" | "delete",
  url: string,
  options?: Record<string, unknown>,
  retries = 3,
): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const response = options
      ? await request[method](url, options)
      : await request[method](url);

    if (response.status() !== 429) {
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
  }

  return options
    ? await request[method](url, options)
    : await request[method](url);
}
