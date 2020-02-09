const test = require('tape')
const pull = require('pull-stream')

const dir = '/tmp/ssb-browser-validate'

require('rimraf').sync(dir)

require('../core.js').init(dir)

SSB.events.on('SSB: loaded', function() {

  test('Base', t => {
    const post = { type: 'post', text: 'Testing!' }
    
    SSB.publish(post, (err, postMsg) => {
      if (err) console.error(err)

      t.equal(postMsg.value.content.text, post.text, 'text correct')
      t.end()
    })
  })

  test('Multiple', t => {
    const post = { type: 'post', text: 'Testing!' }

    SSB.publish(post, (err, postMsg) => {
      if (err) console.error(err)

      const post2 = { type: 'post', text: 'Testing 2!' }

      SSB.publish(post2, (err, postMsg2) => {
        if (err) console.error(err)
        t.equal(postMsg2.value.content.text, post2.text, 'text correct')
        const last = SSB.db.last.get()[SSB.net.id]
        t.notEqual(last.partiel, true, 'not partial')
        t.equal(last.sequence, 3, 'seq ok')
        t.end()
      })
    })
  })

  test('Raw new feed', t => {
    const msg = {
      previous: '%GJEQNFyW41AEg4jTX+X0NfUmIA1Bzp4YsTVkPI05vWk=.sha256',
      sequence: 9,
      author: '@8RB4LVewufL7oFdvcbetA/4yfXoDVNfLema8zQ0kz1s=.ed25519',
      timestamp: 1581277469636,
      hash: 'sha256',
      content: { type: 'post', text: 'Testing 2!' },
      signature: 'uUyG7Wc9obJE/mq94R/nAclA2Hcei35TafIKeoVd48yNcSshs/gKVH7TtcuKvdWcIrnadirUHdO9IGJL5dPcCg==.sig.ed25519'
    }

    SSB.db.validateAndAdd(msg, (err, postMsg) => {
      if (err) console.error(err)

      t.equal(postMsg.value.content.text, msg.content.text, 'text correct')
      t.end()
    })
  })

  test('Raw feed with unused type + ooo', t => {
    const validate = require('ssb-validate')
    var state = validate.initial()
    var keys = require('ssb-keys').generate()

    state = validate.appendNew(state, null, keys, { type: 'post', text: 'test1' }, Date.now()) // ooo
    state = validate.appendNew(state, null, keys, { type: 'post', text: 'test2' }, Date.now()) // missing
    state = validate.appendNew(state, null, keys, { type: 'post', text: 'test3' }, Date.now()) // start
    state = validate.appendNew(state, null, keys, { type: 'vote', vote: { link: '%something.sha256', value: 1 } }, Date.now())
    state = validate.appendNew(state, null, keys, { type: 'post', text: 'test5' }, Date.now())
    state = validate.appendNew(state, null, keys, { type: 'post', text: 'test6' }, Date.now())

    SSB.db.validateAndAdd(state.queue[2].value, (err) => {
      if (err) console.error(err)

      SSB.db.validateAndAdd(state.queue[3].value, (err) => {
        if (err) console.error(err)

        t.equal(SSB.db.last.get()[keys.id].partial, true, 'is partial')

        SSB.db.validateAndAdd(state.queue[4].value, (err) => {
          if (err) console.error(err)

          SSB.db.validateAndAdd(state.queue[5].value, (err) => {
            if (err) console.error(err)

            SSB.db.validateAndAdd(state.queue[0].value, (err, oooMsg) => {
              if (err) console.error(err)

              t.equal(oooMsg.value.content.text, 'test1', 'text correct')

              const last = SSB.db.last.get()[keys.id]
              t.equal(last.partial, true, 'is partial still')
              t.equal(last.sequence, 6, 'correct seq')

              t.end()
            })
          })
        })
      })
    })
  })

})
