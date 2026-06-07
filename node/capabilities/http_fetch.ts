export async function http_fetch(inputs: Record<string, any>): Promise<{ body: string; status: number }> {
  const response = await fetch(String(inputs.url), {
    method: inputs.method ?? 'GET',
  })
  const body = await response.text()
  return { body, status: response.status }
}
