'use strict'

const baseswim = require('baseswim')
const EE = require('events')
const inherits = require('util').inherits
const bsb = require('binary-search-bounds')
const farmhash = require('farmhash')

function Hashring (opts) {
  if (!(this instanceof Hashring)) {
    return new Hashring(opts)
  }

  opts = opts || {}
  opts.ringname = opts.ringname || 'hashring'
  opts.local = opts.local || {}
  opts.replicaPoints = opts.replicaPoints || 100
  opts.local.meta = opts.local.meta || {}
  opts.local.meta.ringname = opts.ringname

  this.ringname = opts.local.meta.ringname
  this._mymeta = null

  this._peers = []

  this.swim = baseswim(opts)
  this.swim.on('up', () => {
    var id = this.swim.whoami()
    this._mymeta = {
      id: id,
      points: genReplicaPoints(id, opts.replicaPoints),
      meta: opts.local.meta
    }
    this._add(this._mymeta)
    this.emit('up')
  })
  this.swim.on('peerUp', (peer) => {
    if (!peer.meta || peer.meta.ringname !== this.ringname) {
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
    if (!peer.meta || peer.meta.ringname !== this.ringname) {
      return
    }
    this._remove(peer)
    this.emit('peerDown', {
      id: peer.host,
      meta: peer.meta
    })
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
    this._peers.push(point)
  }
  this._peers.sort(sortPoints)
}

Hashring.prototype._remove = function (data) {
  this._peers = this._peers.filter((peer) => peer.data.id === data.id)
}

Hashring.prototype.lookup = function (key) {
  var index = bsb.gt(this._peers, {
    point: farmhash.hash32(key)
  }, sortPoints)
  return this._peers[index].peer
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
  if (a.point > b.point) {
    return 1
  } else if (b.point > a.point) {
    return -1
  } else {
    return 0
  }
}

module.exports = Hashring
