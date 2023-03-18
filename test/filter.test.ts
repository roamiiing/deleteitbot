import { describe, it } from 'std/testing/bdd.ts'
import { assert } from 'std/testing/asserts.ts'

import { filter } from 'src/filter.ts'
import { processConfig } from 'src/config.ts'

import suite from './suite.json' assert { type: 'json' }

const TRIVIAL_CONFIG = processConfig({
  chats: [],
  banWords: suite.bannedWords,
})

const appliedFilter = filter(TRIVIAL_CONFIG)

describe('filter test suite', () => {
  suite.testMessages.shouldBeBanned.forEach((text) => {
    it(`should ban: ${text}`, () => {
      const message = { text }
      const { isBanned } = appliedFilter(message)
      assert(isBanned)
    })
  })

  suite.testMessages.shouldNotBeBanned.forEach((text) => {
    it(`should not ban: ${text}`, () => {
      const message = { text }
      const { isBanned } = appliedFilter(message)
      assert(!isBanned)
    })
  })
})
