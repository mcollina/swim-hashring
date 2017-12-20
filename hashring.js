'use strict'

const baseswim = require('baseswim')
const EE = require('events')
const inherits = require('util').inherits
const bsb = require('binary-search-bounds')
const farmhash = require('farmhash')
const maxInt = Math.pow(2, 32) - 1

function Hashring (opts) {
  if (!(this instanceof Hashring)) {
    return new Hashring(opts)
  }

  opts = opts || {}
  opts.ringname = opts.ringname || 'hashring'
  opts.local = opts.local || {}
  opts.replicaPoints = opts.replicaPoints || 100
  opts.local.meta = opts.local.meta || opts.meta || {}
  opts.local.meta.ringname = opts.ringname
  opts.local.meta.client = opts.client

  this.hash = opts.hashFunc || farmhash.hash32
  this.ringname = opts.local.meta.ringname
  this._mymeta = null

  this._entries = []
  this._peers = new Map()

  this.swim = baseswim(opts)
  this.swim.on('up', () => {
    var id = this.swim.whoami()
    if (!opts.client) {
      this._mymeta = {
        id: id,
        points: genReplicaPoints(id, opts.replicaPoints),
        meta: opts.local.meta
      }
      this._add(this._mymeta)
    }
    this.emit('up')
  })
  this.swim.on('peerUp', (peer) => {
    if (!peer.meta || peer.meta.ringname !== this.ringname || peer.meta.client) {
      return
    }

    let meta = {
      id: peer.host,
      meta: peer.meta,
      points: genReplicaPoints(peer.host, opts.replicaPoints)
    }
    this._peers.set(meta.id, meta)
    this._add(meta)
    this.emit('peerUp', meta)
  })
  this.swim.on('peerDown', (peer) => {
    if (!peer.meta || peer.meta.ringname !== this.ringname || peer.meta.client) {
      return
    }
    const meta = {
      id: peer.host,
      meta: peer.meta
    }
    this._peers.delete(meta.id)
    this._remove(meta)
    this.emit('peerDown', meta)
  })
  this.swim.on('error', err => {
    this.emit('error', err)
  })
}

inherits(Hashring, EE)

function emitMove (that, event) {
  that.emit('move', event)
}

Hashring.prototype._add = function (data) {
  const myid = this.whoami()
  const points = data.points.sort(intSort)
  data.points = points
  for (let i = 0; i < points.length; i++) {
    let entry = {
      peer: data,
      point: points[i]
    }

    // add a point to the array keeping it ordered
    let index = bsb.gt(this._entries, entry, sortPoints)

    let before
    if (entry.peer.id === myid) {
      // do nothing
      // TODO
    } else if (index === 0) {
      before = this._entries[this._entries.length - 1]
      if (before && this._entries[0] && this._entries[0].peer.id === myid) {
        let event = {
          start: before.point,
          end: maxInt,
          to: entry.peer,
          path: 'a1'
        }

        process.nextTick(emitMove, this, event)

        event = {
          start: 0,
          end: entry.point,
          to: entry.peer,
          path: 'a2'
        }

        process.nextTick(emitMove, this, event)
      }
    } else if (index === this._entries.length) {
      before = this._entries[this._entries.length - 1]
      if (this._entries[0].peer.id === myid) {
        let event = {
          start: before.point,
          end: entry.point,
          to: entry.peer,
          path: 'b'
        }

        process.nextTick(emitMove, this, event)
      }
    } else {
      before = this._entries[index - 1]

      if (this._entries[index].peer.id === myid) {
        let event = {
          start: before.point,
          end: entry.point,
          to: entry.peer,
          path: 'c'
        }

        process.nextTick(emitMove, this, event)
      }
    }
    this._entries.splice(index, 0, entry)
  }
}

Hashring.prototype._remove = function (data) {
  const myid = this.whoami()
  let prevRemoved
  let lastStart = this._entries[this._entries.length - 1].point
  this._entries = this._entries.filter((entry) => {
    const toRemove = entry.peer.id === data.id
    if (prevRemoved && !toRemove && entry.peer.id === myid) {
      let event

      if (lastStart > prevRemoved.point) {
        event = {
          start: lastStart,
          end: maxInt,
          from: prevRemoved.peer
        }
        lastStart = 0
        this.emit('steal', event)
      }

      event = {
        start: lastStart,
        end: prevRemoved.point,
        from: prevRemoved.peer
      }
      prevRemoved = undefined
      this.emit('steal', event)
    }

    // manage state for the next round
    if (toRemove) {
      prevRemoved = entry
    } else {
      // needed if we the stolen arch does not
      // belong to the current peer
      prevRemoved = undefined
      lastStart = entry.point
    }

    return !toRemove
  })

  if (prevRemoved && this._entries[0] && this._entries[0].peer.id === myid) {
    this.emit('steal', {
      start: lastStart,
      end: prevRemoved.point,
      from: prevRemoved.peer
    })
  }
}

Hashring.prototype.lookup = function (key) {
  let point = 0
  if (!Number.isInteger(key)) {
    point = this.hash(key)
  } else {
    point = key
  }

  let index = bsb.gt(this._entries, {
    point: point
  }, sortPoints)
  if (index === this._entries.length) {
    index = 0
  }

  if (this._entries[index]) {
    return this._entries[index].peer
  }
  return null
}

Hashring.prototype.next = function (key, prev) {
  let point = 0
  if (!Number.isInteger(key)) {
    point = this.hash(key)
  } else {
    point = key
  }
  let index = bsb.gt(this._entries, {
    point: point
  }, sortPoints)

  prev = prev || []

  const peer = this.lookup(point)
  if (peer === null) return null
  let main = peer.id

  if (prev.indexOf(main) < 0) {
    prev.push(main)
  }

  for (let i = index + 1; i < this._entries.length; i++) {
    if (prev.indexOf(this._entries[i].peer.id) < 0) {
      return this._entries[i].peer
    }
  }

  for (let i = 0; i < index; i++) {
    if (prev.indexOf(this._entries[i].peer.id) < 0) {
      return this._entries[i].peer
    }
  }

  return null
}

Hashring.prototype.peers = function (myself) {
  const results = []
  for (let value of this._peers.values()) {
    results.push(value)
  }
  if (myself) {
    results.push(this.mymeta())
  }
  return results
}

Hashring.prototype.allocatedToMe = function (key) {
  const peer = this.lookup(key)
  if (peer === null) return false
  return peer.id === this.whoami()
}

Hashring.prototype.close = function (cb) {
  this.swim.leave(cb)
}

Hashring.prototype.whoami = function () {
  return this.swim.whoami()
}

Hashring.prototype.mymeta = function () {
  if (!this._mymeta) {
    throw new Error('hashring not up yet')
  }

  return this._mymeta
}

function genReplicaPoints (id, max) {
  var points = new Array(max)
  var last = 0
  for (var i = 0; i < max; i++) {
    last = farmhash.hash32(id + last)
    points[i] = last
  }
  return points
}

function sortPoints (a, b) {
  let result = 0
  if (a.point < b.point) {
    result = -1
  } else if (a.point > b.point) {
    result = 1
  }
  return result
}

function intSort (a, b) {
  if (a < b) {
    return -1
  } else if (a > b) {
    return 1
  } else {
    return 0
  }
}

module.exports = Hashring
