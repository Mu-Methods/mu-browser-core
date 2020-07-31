const bipf = require('bipf')
const Obv = require('obv')
const AtomicFile = require('atomic-file')
const debounce = require('lodash.debounce')
const path = require('path')
const sort = require('ssb-sort')
const push = require('push-stream')

const isFeed = require('ssb-ref').isFeed

module.exports = function (log, dir) {
  const queueLatest = require('../waiting-queue')()
  const queueKey = require('../waiting-queue')()
  const queueSequence = require('../waiting-queue')()
  const queueMentions = require('../waiting-queue')()
  const queueRoots = require('../waiting-queue')()
  const queueContacts = require('../waiting-queue')()
  const queueProfiles = require('../waiting-queue')()

  var seq = Obv()
  seq.set(0)

  var keyToSeq = {}
  var authorSequenceToSeq = {}
  var authorLatest = {}

  var mentions = {}
  var roots = {}

  var hops = {}
  var profiles = {}

  var f = AtomicFile(path.join(dir, "indexes/all.json"))

  function atomicSave()
  {
    f.set({
      seq: seq.value,
      keyToSeq,
      authorSequenceToSeq,
      authorLatest,
      mentions,
      roots,
      hops,
      profiles
    }, () => {})
  }
  var save = debounce(atomicSave, 1000)

  f.get((err, data) => {
    var count = 0
    const start = Date.now()

    if (!err) {
      seq.set(data.seq)

      keyToSeq = data.keyToSeq
      authorSequenceToSeq = data.authorSequenceToSeq
      authorLatest = data.authorLatest
      mentions = data.mentions
      roots = data.roots
      hops = data.hops
      profiles = data.profiles
    }

    const bValue = Buffer.from('value')
    const bKey = Buffer.from('key')
    const bAuthor = Buffer.from('author')
    const bSequence = Buffer.from('sequence')
    const bTimestamp = Buffer.from('timestamp')

    const bContent = Buffer.from('content')
    const bRoot = Buffer.from('root')
    const bMentions = Buffer.from('mentions')

    const bType = Buffer.from('type')
    const bContact = Buffer.from('contact')
    const bAbout = Buffer.from('about')

    function updateContactData(from, content) {
      var to = content.contact
      var value =
          content.blocking || content.flagged ? -1 :
          content.following === true ? 1
          : -2 // this -2 is wierd, but is how it is in ssb-friends

      if (isFeed(from) && isFeed(to)) {
        hops[from] = hops[from] || {}
        hops[from][to] = value
      }
    }

    function updateProfileData(author, content) {
      if (content.about != author) return

      let profile = profiles[author] || {}

      if (content.name)
        profile.name = content.name

      if (content.description)
        profile.description = content.description

      if (content.image && typeof content.image.link === 'string')
        profile.image = content.image.link
      else if (typeof content.image === 'string')
        profile.image = content.image

      profiles[author] = profile
    }

    function handleData(data) {
      var p = 0 // note you pass in p!
      p = bipf.seekKey(data.value, p, bKey)
      const key = bipf.decode(data.value, p)
      keyToSeq[key] = data.seq

      p = 0
      p = bipf.seekKey(data.value, p, bValue)
      if (~p) {
        var p2 = bipf.seekKey(data.value, p, bAuthor)
        const author = bipf.decode(data.value, p2)
        var p3 = bipf.seekKey(data.value, p, bSequence)
        const sequence = bipf.decode(data.value, p3)
        var p4 = bipf.seekKey(data.value, p, bTimestamp)
        const timestamp = bipf.decode(data.value, p4)
        authorSequenceToSeq[[author, sequence]] = data.seq
        var latestSequence = 0
        if (authorLatest[author])
          latestSequence = authorLatest[author].sequence
        if (sequence > latestSequence) {
          authorLatest[author] = {
            id: key,
            sequence,
            timestamp
          }
        }

        // content
        var pContent = bipf.seekKey(data.value, p, bContent)
        if (~pContent) {
          var pRoot = bipf.seekKey(data.value, pContent, bRoot)
          if (~pRoot) {
            const root = bipf.decode(data.value, pRoot)
            if (root) {
              let d = roots[root] || []
              d.push(data.seq)
              roots[root] = d
            }
          }

          var p3 = bipf.seekKey(data.value, pContent, bMentions)
          if (~p3) {
            const mentionsData = bipf.decode(data.value, pContent)
            if (Array.isArray(mentionsData)) {
              mentionsData.forEach(mention => {
                if (mention.link &&
                    typeof mention.link === 'string' &&
                    (mention.link[0] === '@' || mention.link[0] === '%')) {
                  let d = mentions[mention.link] || []
                  d.push(data.seq)
                  mentions[mention.link] = d
                }
              })
            }
          }

          var pType = bipf.seekKey(data.value, pContent, bType)
          if (~pType) {
            if (bipf.compareString(data.value, pType, bContact) === 0)
              updateContactData(author, bipf.decode(data.value, pContent))
            else if (bipf.compareString(data.value, pType, bAbout) === 0)
              updateProfileData(author, bipf.decode(data.value, pContent))
          }
        }
      }

      seq.set(data.seq)
      count++

      save()
    }

    log.stream({ gt: seq.value }).pipe({
      paused: false,
      write: handleData,
      end: () => {
        console.log(`key index full scan time: ${Date.now()-start}ms, total items: ${count}`)

        log.stream({ gt: seq.value, live: true }).pipe({
          paused: false,
          write: handleData
        })

        queueLatest.done(null, authorLatest)
        queueKey.done(null, keyToSeq)
        queueSequence.done(null, authorSequenceToSeq)
        queueMentions.done(null, mentions)
        queueRoots.done(null, roots)
        queueContacts.done(null, hops)
        queueProfiles.done(null, profiles)
      }
    })
  })

  function queueGet(queue, key, cb)
  {
    queue.get((err, data) => {
      if (data && data[key]) {
        push(
          push.values(data[key]),
          push.asyncMap(log.get),
          push.collect((err, results) => {
            const msgs = results.map(x => bipf.decode(x, 0))
            sort(msgs)
            msgs.reverse()
            cb(null, msgs)
          })
        )
      }
    })
  }

  return self = {
    contacts: {
      isFollowing: function(source, dest) {
        return hops[source][dest] === 1
      },
      isBlocking: function(source, dest) {
        return hops[source][dest] === -1
      },
      getGraphForFeed: function(feed, cb) {
        queueContacts.get((err, hops) => {
          cb(err, self.contacts.getGraphForFeedSync(feed))
        })
      },
      // might return empty when hops is not loaded yet
      getGraphForFeedSync: function(feed) {
        let following = []
        let blocking = []
        let extended = []

        for (var relation in hops[feed]) {
          if (self.contacts.isFollowing(feed, relation))
            following.push(relation)
          else if (self.contacts.isBlocking(feed, relation))
            blocking.push(relation)
        }

        for (var feedId in hops) {
          if (feedId === feed)
            continue

          if (!following.includes(feedId))
            continue

          for (var relation in hops[feedId]) {
            if (self.contacts.isFollowing(feedId, relation)) {
              if (relation === feed)
                continue

              if (following.includes(relation))
                continue

              if (blocking.includes(relation))
                continue

              extended.push(relation)
            }
          }
        }

        return {
          following,
          blocking,
          extended: [...new Set(extended)]
        }
      }
    },

    profiles: {
      get: queueProfiles.get
    },

    getMessagesByMention: function(key, cb) {
      queueGet(queueMentions, key, cb)
    },
    getMessagesByRoot: function(rootId, cb) {
      queueGet(queueRoots, rootId, cb)
    },

    keysGet: function(key, cb) {
      queueKey.get(() => {
        if (!keyToSeq[key])
          cb('Key not found:' + key)
        else
          log.get(keyToSeq[key], (err, data) => {
            if (err) return cb(err)
            cb(null, bipf.decode(data, 0))
          })
      })
    },
    clockGet: function(key, cb) {
      queueSequence.get(() => {
        if (!authorSequenceToSeq[key])
          cb('Key not found:' + key)
        else
          log.get(authorSequenceToSeq[key], (err, data) => {
            if (err) return cb(err)
            cb(null, bipf.decode(data, 0))
          })
      })
    },
    lastGet: function(feedId, cb) {
      queueLatest.get(() => {
        if (!authorLatest[feedId])
          cb('Author not found:' + feedId)
        else
          cb(null, authorLatest[feedId])
      })
    },
    getAllLatest: function(cb) {
      queueLatest.get(cb)
    },
    seq,
    keyToSeq(key, cb) {
      queueKey.get(() => {
        if (!keyToSeq[key])
          cb('Key not found:' + key)
        else
          cb(null, keyToSeq[key])
      })
    },
    removeFeedFromLatest: function(feedId) {
      delete authorLatest[feedId]
    },
    remove: function(cb) {
      f.destroy(cb)
    }
  }
}
