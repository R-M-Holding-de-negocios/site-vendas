import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hmacSha256Hex, parseSignatureHeader, signatureManifest, verifySignature } from '../../supabase/functions/_shared/signature'

const secret = 'segredo-webhook'
const now = new Date('2026-11-26T12:00:00Z')
const ts = String(Math.floor(now.getTime() / 1000))
const sign = (manifest: string) => createHmac('sha256', secret).update(manifest).digest('hex')

describe('assinatura do webhook do Mercado Pago', () => {
  it('monta o manifesto como na documentação', () => {
    expect(signatureManifest('123456', 'req-1', '1704908010')).toBe('id:123456;request-id:req-1;ts:1704908010;')
    expect(signatureManifest('ABC123', 'req-1', '1')).toBe('id:abc123;request-id:req-1;ts:1;')
    expect(signatureManifest(null, 'req-1', '1')).toBe('request-id:req-1;ts:1;')
    expect(signatureManifest('9', null, '1')).toBe('id:9;ts:1;')
  })

  it('lê o cabeçalho x-signature', () => {
    expect(parseSignatureHeader('ts=1704908010,v1=abc')).toEqual({ ts: '1704908010', v1: 'abc' })
    expect(parseSignatureHeader(' v1 = abc , ts = 5 ')).toEqual({ ts: '5', v1: 'abc' })
    expect(parseSignatureHeader('v1=abc')).toBeNull()
    expect(parseSignatureHeader(null)).toBeNull()
  })

  it('HMAC-SHA256 em hexadecimal igual ao do Node', async () => {
    expect(await hmacSha256Hex(secret, 'id:1;ts:2;')).toBe(sign('id:1;ts:2;'))
  })

  it('aceita assinatura válida', async () => {
    const v1 = sign(`id:987654;request-id:req-9;ts:${ts};`)
    expect(await verifySignature({ secret, header: `ts=${ts},v1=${v1}`, requestId: 'req-9', dataId: '987654', now })).toBe('ok')
  })

  it('aceita ts em milissegundos', async () => {
    const ms = String(now.getTime())
    const v1 = sign(`id:1;request-id:r;ts:${ms};`)
    expect(await verifySignature({ secret, header: `ts=${ms},v1=${v1}`, requestId: 'r', dataId: '1', now })).toBe('ok')
  })

  it('recusa assinatura inválida, de outro pagamento ou com outro segredo', async () => {
    const v1 = sign(`id:987654;request-id:req-9;ts:${ts};`)
    expect(await verifySignature({ secret, header: `ts=${ts},v1=${v1}`, requestId: 'req-9', dataId: '111', now })).toBe('invalid')
    expect(await verifySignature({ secret: 'outro', header: `ts=${ts},v1=${v1}`, requestId: 'req-9', dataId: '987654', now })).toBe('invalid')
    expect(await verifySignature({ secret, header: `ts=${ts},v1=00${v1.slice(2)}`, requestId: 'req-9', dataId: '987654', now })).toBe('invalid')
    expect(await verifySignature({ secret, header: null, requestId: 'req-9', dataId: '987654', now })).toBe('missing')
    expect(await verifySignature({ secret: '', header: `ts=${ts},v1=${v1}`, requestId: 'req-9', dataId: '987654', now })).toBe('missing')
  })

  it('recusa notificação antiga (ts fora da tolerância)', async () => {
    const old = String(Math.floor(now.getTime() / 1000) - 3600)
    const v1 = sign(`id:1;request-id:r;ts:${old};`)
    expect(await verifySignature({ secret, header: `ts=${old},v1=${v1}`, requestId: 'r', dataId: '1', now })).toBe('stale')
    expect(await verifySignature({ secret, header: `ts=${old},v1=${v1}`, requestId: 'r', dataId: '1', now, toleranceS: 7200 })).toBe('ok')
  })
})
