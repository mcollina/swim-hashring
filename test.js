'use strict'

const test = require('tap').test
const hashring = require('.')

function opts () {
  return {
    joinTimeout: 20
  }
}

test('two peer lookup', (t) => {
  t.plan(7)

  const i1 = hashring(opts())
  const key = 'hello'
  t.tearDown(i1.close.bind(i1))
  i1.on('up', () => {
    t.pass('i1 up')
    const i2 = hashring({
      joinTimeout: 20,
      base: [i1.whoami()]
    })
    t.tearDown(i2.close.bind(i2))

    i2.on('up', () => {
      t.pass('i2 up')

      let v1 = i1.lookup(key)
      let v2 = i2.lookup(key)
      t.deepEqual(v1, v2, 'both instances look up correctly')

      t.ok(v1, 'value is not null')
      t.ok(i1.mymeta(), 'i1 metadata is not null')
      t.ok(i2.mymeta(), 'i2 metadata is not null')

      if (v1.id === i1.whoami()) {
        t.deepEqual(v1, i1.mymeta(), 'hello is matched by i1')
      } else if (v1.id === i2.whoami()) {
        t.deepEqual(v1, i2.mymeta(), 'hello is matched by i2')
      } else {
        t.fail('value does not match any known peer')
      }
    })
  })
})
