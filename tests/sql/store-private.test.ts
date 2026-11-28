// Migração 0007: colunas internas da loja só para o dono e o admin; conexão do Mercado Pago que caiu.
import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, anon, errorOf, superuser } from './harness'

let db: TestDb
let A: Awaited<ReturnType<TestDb['merchant']>>
let B: Awaited<ReturnType<TestDb['merchant']>>

beforeAll(async () => {
  db = await TestDb.create()
  A = await db.merchant('loja-a')
  B = await db.merchant('loja-b')
  await db.q(superuser, `update stores set theme_draft = '{"x":1}', paid_until = now() where id = $1`, [A.storeId])
})

describe('colunas internas da loja', () => {
  it('visitante e outro lojista não leem rascunho nem datas de cobrança', async () => {
    for (const who of [anon, B.who]) {
      expect(await errorOf(db.q(who, `select theme_draft from stores where id = $1`, [A.storeId]))).toMatch(/permission denied/)
      expect(await errorOf(db.q(who, `select paid_until from stores where id = $1`, [A.storeId]))).toMatch(/permission denied/)
      expect(await db.q(who, `select id, slug, name, settings, theme from stores where id = $1`, [A.storeId])).toHaveLength(1)
    }
    expect(await db.rpc(B.who, 'store_private', { ids: [A.storeId] })).toEqual({})
    expect(await errorOf(db.rpc(anon, 'store_private', { ids: [A.storeId] }))).toMatch(/permission denied/)
  })

  it('o dono lê pela função e continua gravando o rascunho', async () => {
    const r = await db.rpc<Record<string, { theme_draft: unknown; paid_until: string | null }>>(A.who, 'store_private', { ids: [A.storeId, B.storeId] })
    expect(Object.keys(r)).toEqual([A.storeId])
    expect(r[A.storeId].theme_draft).toEqual({ x: 1 })
    expect(r[A.storeId].paid_until).not.toBeNull()
    await db.q(A.who, `update stores set theme_draft = '{"y":2}' where id = $1`, [A.storeId])
  })
})

describe('conexão do Mercado Pago que caiu', () => {
  it('avisa o dono e some das formas de pagamento', async () => {
    await db.q(superuser, `insert into store_secrets (store_id, provider, data) values ($1, 'mercadopago_revoked_2026-11-28', '{"access_token":"x"}')`, [A.storeId])
    expect(await db.rpc(A.who, 'payment_connections', { store_id: A.storeId })).toEqual({ mercadopago: false, mercadopago_lost: true })
    // para os outros não revela nada
    expect(await db.rpc(anon, 'payment_connections', { store_id: A.storeId })).toEqual({ mercadopago: false, mercadopago_lost: false })
    await db.q(superuser, `insert into store_secrets (store_id, provider, data) values ($1, 'mercadopago', '{"access_token":"novo"}')`, [A.storeId])
    expect(await db.rpc(A.who, 'payment_connections', { store_id: A.storeId })).toEqual({ mercadopago: true, mercadopago_lost: false })
  })
})
