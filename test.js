'use strict'

const test = require('tap').test
const hashring = require('.')
const steed = require('steed')
const baseswim = require('baseswim')
const farmhash = require('farmhash')
const maxInt = Math.pow(2, 32) - 1

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
  return peer
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
  t.plan(10)

  const key = 'hello'
  boot(t, (i1) => {
    boot(t, i1, (i2) => {
      let v1 = i1.lookup(key)
      let v2 = i2.lookup(key)
      t.deepEqual(v1, v2, 'both instances look up correctly')

      t.ok(v1, 'value is not null')
      t.ok(i1.mymeta(), 'i1 metadata is not null')
      t.ok(i2.mymeta(), 'i2 metadata is not null')
      t.deepEqual(i1.lookup(key), i1.lookup(i1.hash(key)), 'lookup by hash')

      if (v1.id === i1.whoami()) {
        t.deepEqual(v1, i1.mymeta(), 'hello is matched by i1')
        t.ok(i1.allocatedToMe(key), 'key is allocated to i1')
        t.notOk(i2.allocatedToMe(key), 'key is not allocated to i2')
      } else if (v1.id === i2.whoami()) {
        t.deepEqual(v1, i2.mymeta(), 'hello is matched by i2')
        t.ok(i2.allocatedToMe(key), 'key is allocated to i2')
        t.notOk(i1.allocatedToMe(key), 'key is not allocated to i1')
      } else {
        t.fail('value does not match any known peer')
      }
    })
  })
})

test('peers()', (t) => {
  t.plan(4)

  boot(t, (i1) => {
    boot(t, i1, (i2) => {
      t.deepEqual(i1.peers(), [i2.mymeta()], 'peers matches')
      t.deepEqual(i1.peers(true), [i2.mymeta(), i1.mymeta()], 'peers with myself matches')
    })
  })
})

test('10 peers', (t) => {
  t.plan(23)

  const key = 'hello'
  bootN(t, 10, (peers) => {
    const root = peers[0]
    let value = root.lookup(key)
    for (let i = 0; i < peers.length; i++) {
      let current = peers[i].lookup(key)
      t.deepEqual(value.id, current.id, 'both instances look up correctly')
    }
    let computedPeers = root.peers()
    t.equal(computedPeers.length, peers.length - 1, 'all peers minus one')
    computedPeers = computedPeers.filter((peer) => {
      return !peers.reduce((acc, p) => acc || p.whoami() === peer.id, false)
    })
    t.equal(computedPeers.length, 0, 'all peers accounted for')
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

test('move event', { timeout: 5000 }, (t) => {
  let events = 0
  let moved = 0
  boot(t, (i1) => {
    const i1id = i1.whoami()
    let receivedPeer
    i1.on('move', (moveEvent) => {
      t.ok(Number.isInteger(moveEvent.start), 'start exists')
      t.ok(Number.isInteger(moveEvent.end), 'end exists')
      t.ok(moveEvent.start < moveEvent.end, 'start < end')
      t.ok(moveEvent.to, 'peer exists')
      const key = moveEvent.end - 1
      t.notOk(i1.allocatedToMe(key), 'not allocated to me')
      receivedPeer = moveEvent.to
      t.notEqual(moveEvent.to.id, i1id, 'id of the other peer')
      moved += moveEvent.end - moveEvent.start
      events++
    })
    boot(t, i1, (i2) => {
      t.deepEqual(receivedPeer, i2.mymeta(), 'peer matches')
      t.pass('got ' + events + ' moves')
      t.ok(events > 10, 'some overlap')
      let movedPercent = Math.round(moved / maxInt * 1000) / 1000
      t.ok(movedPercent >= 0.40, 'at least 40% is reallocated, got: ' + movedPercent)
      t.ok(movedPercent <= 1, 'we reallocate at most 100%, got: ' + movedPercent)
      t.end()
    })
  })
})

test('client', (t) => {
  t.plan(4)

  boot(t, (i1) => {
    boot(t, i1, (i2) => {
      const client = hashring({
        client: true,
        joinTimeout: 1000,
        base: [i1.whoami(), i2.whoami()]
      })
      t.tearDown(client.close.bind(client))
      client.on('error', t.fail.bind(t))
      client.on('up', () => {
        t.pass('client up')
        for (var i = 0; i < maxInt; i += 1000) {
          if (client.allocatedToMe(i) || i1.lookup(i).id === client.whoami()) {
            t.fail('data allocated to a client')
            return
          }
        }
        t.pass('no errors')
      })
    })
  })
})

test('steal event', { timeout: 5000 }, (t) => {
  let stolen = 0
  let moved = 0
  boot(t, (i1) => {
    i1.on('move', (moveEvent) => {
      moved += moveEvent.end - moveEvent.start
    })
    boot(t, i1, (i2) => {
      i1.on('steal', (stealEvent) => {
        t.ok(Number.isInteger(stealEvent.start), 'start exists')
        t.ok(Number.isInteger(stealEvent.end), 'end exists')
        t.ok(stealEvent.start < stealEvent.end, 'start < end')
        t.ok(stealEvent.from, 'peer exists')
        t.deepEqual(i2.mymeta(), stealEvent.from, 'peer matches')
        stolen += stealEvent.end - stealEvent.start
      })
      i1.on('peerDown', () => {
        let stolenPercent = Math.round(stolen / maxInt * 1000) / 1000
        t.ok(stolenPercent >= 0.40, 'at least 40% is reallocated, got: ' + stolenPercent)
        t.ok(stolenPercent <= 1, 'we reallocate at most 100%, got: ' + stolenPercent)
        const difference = stolen - moved
        t.equal(difference, 0, 'the difference between stolen and moved')
        t.equal(stolen, moved, 'same amount of the ring is stolen and moved')
        t.end()
      })
      i2.close()
    })
  })
})

test('next peer lookup', (t) => {
  t.plan(7)

  const key = 'hello'
  boot(t, (i1) => {
    boot(t, i1, (i2) => {
      let v1 = i1.lookup(key)
      let next = i1.next(key)
      t.ok(v1, 'value is not null')
      t.ok(next, 'value is not null')

      t.notEqual(v1.id, next.id, 'ids does not match')

      if (v1.id === i1.whoami()) {
        t.deepEqual(next, i2.mymeta(), 'hello.next is matched by i2')
      } else if (v1.id === i2.whoami()) {
        t.deepEqual(next, i1.mymeta(), 'hello.next is matched by i1')
      } else {
        t.fail('value does not match any known peer')
      }

      next = i1.next(key, [next.id])
      t.notOk(next, 'no next for circuit breaking support')
    })
  })
})
