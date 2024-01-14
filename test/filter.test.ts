import { describe, it } from 'std/testing/bdd.ts'
import { assert, assertEquals } from 'std/testing/asserts.ts'

import { filter } from 'src/filter.ts'
import { processConfig } from 'src/config.ts'

import suite from './suite.json' with { type: 'json' }

const TRIVIAL_CONFIG = processConfig({
  timeout: 0,
  chats: [],
  banWords: suite.bannedWords,
})

const appliedFilter = filter(TRIVIAL_CONFIG)

describe('filter test suite', () => {
  Object.entries(suite.testMessages.shouldBeBanned).forEach(
    ([text, replaced]) => {
      it(`should ban: ${text}`, () => {
        const message = { text }
        const filtered = appliedFilter(message)
        assert(filtered.isBanned)
        assertEquals(filtered.replaced, replaced)
      })
    },
  )

  suite.testMessages.shouldNotBeBanned.forEach((text) => {
    it(`should not ban: ${text}`, () => {
      const message = { text }
      const { isBanned } = appliedFilter(message)
      assert(!isBanned)
    })
  })
})
