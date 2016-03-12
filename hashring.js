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

  this._peers = []

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
    this._remove(meta)
    this.emit('peerDown', meta)
  })
}

inherits(Hashring, EE)

Hashring.prototype._add = function (data) {
  let points = data.points
  for (let i = 0; i < points.length; i++) {
    let point = {
      peer: data,
      point: points[i]
    }

    // add a point to the array keeping it ordered
    let index = bsb.gt(this._peers, point, sortPoints)
    if (index < 0) {
      index = this._peers.length
    }

    this._peers.splice(index, 0, point)
    if (this._peers[index + 1] && this._peers[index + 1].peer.id === this.whoami()) {
      let event = {
        start: point.point,
        end: this._peers[index + 1].point,
        to: point.peer
      }
      this.emit('move', event)
    } else if (!this._peers[index + 1] && this._peers[0] && this._peers[0].peer.id === this.whoami()) {
      let event = {
        start: point.point,
        end: maxInt,
        to: point.peer
      }
      this.emit('move', event)
      event = {
        start: 0,
        end: this._peers[0].point,
        to: point.peer
      }
      this.emit('move', event)
    }
  }
}

Hashring.prototype._remove = function (data) {
  this._peers = this._peers.filter((peer) => peer.peer.id === data.id)
}

Hashring.prototype.lookup = function (key) {
  let point = 0
  if (!Number.isInteger(key)) {
    point = this.hash(key)
  } else {
    point = key
  }
  var index = bsb.gt(this._peers, {
    point: point
  }, sortPoints)
  if (index === this._peers.length) {
    index = 0
  }
  return this._peers[index].peer
}

Hashring.prototype.allocatedToMe = function (key) {
  return this.lookup(key).id === this.whoami()
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

module.exports = Hashring
