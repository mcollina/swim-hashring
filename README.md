# swim-hashring

Application-level sharding for node.js, similar to
[ringpop](https://github.com/uber/ringpop-node). You can use it to
maintain in-memory state between a cluster of nodes, and it allows you
to route your requests accordingly.

**swim-hashring** is a library that implements a distributed sharding system using a gossip membership protocol ([swim](http://npm.im/swim)) and a [consistent hash ring](http://www.martinbroadhurst.com/Consistent-Hash-Ring.html) based on [farmhash](http://npm.im/farmhash).

This library does not assume any particular application protocol.

<a name="install"></a>
## Install

```
npm i swim-hashring -g
```

<a name="api"></a>
## API

  * <a href="#constructor"><code><b>hashring()</b></code></a>
  * <a href="#lookup"><code>instance.<b>lookup()</b></code></a>
  * <a href="#allocatedToMe"><code>instance.<b>allocatedToMe()</b></code></a>
  * <a href="#whoami"><code>instance.<b>whoami()</b></code></a>
  * <a href="#mymeta"><code>instance.<b>mymeta()</b></code></a>
  * <a href="#hash"><code>instance.<b>hash()</b></code></a>
  * <a href="#close"><code>instance.<b>close()</b></code></a>

<a name="constructor"></a>
### hashring(opts)

Create a new hashring.

Options:

* `name`: the name of the ring, it defaults to `'hashring'`. Needed if
  you want to run mulitple hashrings into the same swim network.
* `meta`: all the metadata for the current node, it will be disseminated
  across the gossip network.
* `hashFunc`: the hashing function you want to use, default to
  `[farmhash](http://npm.im/farmhash).hash32`.
* `replicaPoints`: the number of replica points each node would have.
  Every node needs to have the same configuration for this value.
* `host`: the ip address the current node will use to advertise itself
  on the swim network. Defaults to what is returned by
  [network-address](http://npm.im/network-address).
* `port`: the port the current node will use to advertise itself
  on the swim network. Randomly picked if not specified.
* `base`: an array of nodes that will be used to boostrap the swim
  network. The value is what is returned by [`whomai()`](#whomai).
* `client`: if you are writing an hashring client rather than a normal
  peer. Defaults to `false`.

Events:

* `'up'`: when the node is up and running
* `'peerUp'`: when a peer that is part of the hashring gets online
* `'peerDown'`: when a peer that is part of the hashring gets offline
* `'move'`: when a part of the hashring gets moved from the current peer
  to another peer, relevant keys `start`, `end`, `to`.

<a name="lookup"></a>
### instance.lookup(key)

Lookup the peer handling a given `key`, which it can be a `String`, a
`Buffer` or an integer. The integer needs to be the result of
[`instance.hash(key`)](#hash).

It returns:

```js
{
  id: '192.168.0.1',
  meta: {
    // all metadata specified in
  },
  points: [
    // n integers, where n is the number of replica points
  ]
}
```

<a name="whoami"></a>
### instance.whoami()

The id of the current peer. It will throw if the node has not emitted
`'up'` yet.

<a name="mymeta"></a>
### instance.mymeta()

It returns the info of the current node in the same format of
[`lookup()`](#lookup).

<a name="allocatedToMe"></a>
### instance.allocatedToMe(key)

Similar to [`lookup(key)`](#lookup), but returns `true` or `false`
depending if the given key has been allocated to this node or not.

<a name="hash"></a>
### instance.hash(key)

Hashes the given key using the same hash function used to calculate
replica points. It returns an integer.

<a name="close"></a>
### instance.close()

Close the instance, detaching it from the gossip network.

## License

MIT
