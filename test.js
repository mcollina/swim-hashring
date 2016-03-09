'use strict'

const test = require('tap').test
const hashring = require('.')
const steed = require('steed')
const baseswim = require('baseswim')
const farmhash = require('farmhash')

function boot (t, root, cb) {
  if (typeof root === 'function') {
    cb = root
    root = null
  }
  const opts = {
    joinTimeout: 1000
  }
  if (root) {
    opts.base = [root.whoami()]
  }
  const peer = hashring(opts)
  t.setMaxListeners(100)
  t.tearDown(peer.close.bind(peer))
  peer.on('error', t.fail.bind(t))
  peer.on('up', () => {
    t.pass('peer up')
    cb(peer)
  })
}

function bootN (t, num, cb) {
  num = num - 1
  boot(t, (root) => {
    const peers = new Array(num)
    steed.map(peers, (peer, cb) => {
      boot(t, root, (peer) => cb(null, peer))
    }, (err, peers) => {
      t.error(err)
      if (err) {
        return
      }
      peers.unshift(root)
      cb(peers)
    })
  })
}

test('two peer lookup', (t) => {
  t.plan(7)

  const key = 'hello'
  boot(t, (i1) => {
    boot(t, i1, (i2) => {
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

test('10 peers', (t) => {
  t.plan(21)

  const key = 'hello'
  bootN(t, 10, (peers) => {
    const root = peers[0]
    let value = root.lookup(key)
    for (let i = 0; i < peers.length; i++) {
      let current = peers[i].lookup(key)
      t.deepEqual(value.id, current.id, 'both instances look up correctly')
    }
  })
})

test('is compatible with swim', (t) => {
  t.plan(11)
  boot(t, (root) => {
    const peer = baseswim({
      joinTimeout: 200,
      base: [root.whoami()]
    })

    t.tearDown(peer.leave.bind(peer))
    peer.on('up', () => {
      let key = 'hello'
      for (let i = 0; i < 10; i++) {
        t.deepEqual(root.lookup(key), root.mymeta(), 'key is matched by root')
        key += farmhash.hash32(key)
      }
    })
  })
})
