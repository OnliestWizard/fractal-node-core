export async function passthrough(inputs: Record<string, any>): Promise<{ response: string }> {
  return { response: String(inputs.cached) }
}
