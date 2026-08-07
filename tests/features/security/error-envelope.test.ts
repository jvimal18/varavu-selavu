import { beforeAll, describe, expect, it } from 'vitest'
import { createNuxtTestHarness, type NuxtTestHarness } from '~~/tests/helpers/nuxt-server'

interface LoginErrorEnvelope {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: {
    retryAfter?: number
  }
}

const harness = await createNuxtTestHarness()

function loginHeaders(harness: NuxtTestHarness, label: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    Cookie: '',
    'x-forwarded-for': harness.clientIp(label),
  }
}

async function parseEnvelope(response: Response): Promise<LoginErrorEnvelope> {
  return await response.json() as LoginErrorEnvelope
}

async function setupPin(harness: NuxtTestHarness): Promise<void> {
  const response = await harness.fetch('/api/auth/setup-pin', {
    method: 'POST',
    headers: loginHeaders(harness, 'envelope-bootstrap'),
    body: JSON.stringify({ userId: 'u_vimal', pin: '1234' }),
  })
  expect(response.status, 'Login envelope tests need a real configured PIN before exercising 400/401/429 responses').toBe(200)
}

describe('real HTTP login error envelope', () => {
  beforeAll(async () => {
    await setupPin(harness)
  })

  it('returns a structured 400 envelope for a malformed login body without retryAfter', async () => {
    const response = await harness.fetch('/api/auth/login', {
      method: 'POST',
      headers: loginHeaders(harness, 'envelope-malformed'),
      body: JSON.stringify({}),
    })
    expect(response.status, 'Malformed login input must remain a client-visible 400 error').toBe(400)
    const envelope = await parseEnvelope(response)
    expect(envelope.statusCode, 'Malformed login response must expose statusCode 400 in the parsed envelope').toBe(400)
    expect(typeof envelope.message, 'Malformed login response must expose human text in data.message for the client store').toBe('string')
    expect(envelope.message?.length, 'Malformed login human text must not be an empty client message').toBeGreaterThan(0)
    expect(envelope.data?.retryAfter, 'A normal malformed-request 400 must not expose a rate-limit retryAfter').toBeUndefined()
  })

  it('returns a structured 401 envelope for a wrong PIN without retryAfter', async () => {
    const response = await harness.fetch('/api/auth/login', {
      method: 'POST',
      headers: loginHeaders(harness, 'envelope-wrong-pin'),
      body: JSON.stringify({ userId: 'u_vimal', pin: '9999' }),
    })
    expect(response.status, 'Wrong PIN must remain a client-visible 401 rather than a generic server error').toBe(401)
    const envelope = await parseEnvelope(response)
    expect(envelope.statusCode, 'Wrong PIN response must expose statusCode 401 in the parsed envelope').toBe(401)
    expect(typeof envelope.message, 'Wrong PIN response must expose human text in data.message for the client store').toBe('string')
    expect(envelope.message?.length, 'Wrong PIN human text must not be an empty client message').toBeGreaterThan(0)
    expect(envelope.data?.retryAfter, 'A wrong-PIN 401 must not expose a rate-limit retryAfter').toBeUndefined()
  })

  it('returns 429 with a positive nested retryAfter on the sixth request after five failures from one IP', async () => {
    const ipLabel = 'envelope-per-ip-block'
    const pinSetup = await harness.fetch('/api/auth/setup-pin', {
      method: 'POST',
      headers: loginHeaders(harness, 'envelope-second-user-setup'),
      body: JSON.stringify({ userId: 'u_pavithra', pin: '5678' }),
    })
    expect(pinSetup.status, 'Per-IP envelope coverage needs a second configured account to isolate account cooldown state').toBe(200)

    for (let attempt = 1; attempt <= 5; attempt++) {
      const failure = await harness.fetch('/api/auth/login', {
        method: 'POST',
        headers: loginHeaders(harness, ipLabel),
        body: JSON.stringify({ userId: 'u_pavithra', pin: '9999' }),
      })
      expect(failure.status, `The ${attempt}th wrong PIN must be recorded before the per-IP block is returned`).toBe(401)
    }

    const response = await harness.fetch('/api/auth/login', {
      method: 'POST',
      headers: loginHeaders(harness, ipLabel),
      body: JSON.stringify({ userId: 'u_pavithra', pin: '9999' }),
    })
    expect(response.status, 'The sixth valid-shaped login request after five wrong PINs must activate the per-IP 429 block').toBe(429)
    const envelope = await parseEnvelope(response)
    expect(envelope.statusCode, 'Per-IP block response must expose statusCode 429 in the parsed envelope').toBe(429)
    expect(typeof envelope.message, 'Per-IP block response must expose human text in data.message for the client store').toBe('string')
    expect(envelope.message?.length, 'Per-IP block human text must not be an empty client message').toBeGreaterThan(0)

    const retryAfter = envelope.data?.retryAfter
    expect(typeof retryAfter, 'Per-IP block response must include a numeric retryAfter in its nested data').toBe('number')
    const retrySeconds = typeof retryAfter === 'number' ? retryAfter : 0
    expect(retrySeconds, 'Per-IP block retryAfter must be positive so the client can display a useful wait').toBeGreaterThan(0)
    expect(response.headers.get('set-cookie'), 'A rate-limited login response must not create a session').toBeNull()
  })

  it('keeps client-facing text in the parsed envelope message rather than requiring statusMessage or Error.message', async () => {
    const response = await harness.fetch('/api/auth/login', {
      method: 'POST',
      headers: loginHeaders(harness, 'envelope-client-shape'),
      body: JSON.stringify({}),
    })
    const envelope = await parseEnvelope(response)
    expect(envelope.statusCode, 'Parsed auth error shape must retain the HTTP status code').toBe(400)
    expect(typeof envelope.message, 'Client UI contract must provide human text through the parsed response data.message field').toBe('string')
    expect(envelope.message, 'Client UI contract must not require the transport statusMessage as its human text').not.toBe(envelope.statusMessage)
  })
})
