const validate = require('ssb-validate')
const keys = require('ssb-keys')
const pull = require('pull-stream')
const raf = require('polyraf')

var remote

exports.connected = function(cb)
{
  if (!remote || remote.closed)
  {
    SSB.net.connect(SSB.remoteAddress, (err, rpc) => {
      if (err) throw(err)

      remote = rpc
      cb(remote)
    })
  } else
    cb(remote)
}

function deleteDatabaseFile(filename) {
  const path = require('path')
  const file = raf(path.join(SSB.dir, filename))
  file.open((err, done) => {
    if (err) return console.error(err)
    file.destroy()
  })
}

exports.removeIndexes = function removeIndexes(fs) {
  SSB.db.clearIndexes()

  const IdbKvStore = require('idb-kv-store')
  const store = new IdbKvStore("/indexes")
  store.clear()
}

exports.removeDB = function() {
  deleteDatabaseFile('log.bipf')
  exports.removeIndexes()
}

exports.removeBlobs = function() {
  function listDir(fs, path)
  {
    fs.root.getDirectory(path, {}, function(dirEntry) {
      var dirReader = dirEntry.createReader()
      dirReader.readEntries(function(entries) {
        for(var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (entry.isDirectory) {
            //console.log('Directory: ' + entry.fullPath);
            listDir(fs, entry.fullPath)
          }
          else if (entry.isFile) {
            console.log('deleting file: ' + entry.fullPath)
            const file = raf(entry.fullPath)
            file.open((err, done) => {
              if (err) return console.error(err)
              file.destroy()
            })
          }
        }
      })
    })
  }

  window.webkitRequestFileSystem(window.PERSISTENT, 0, function (fs) {
    listDir(fs, '/.ssb-lite/blobs')
  })
}

exports.sync = function()
{
  exports.connected((rpc) => {
    SSB.db.getHops((err, hops) => {
      var blocking = []
      for (var feed in hops[SSB.net.id])
        if (hops[SSB.net.id][feed] === -1)
          blocking.push(feed)

      SSB.net.ebt.request(SSB.net.id, true)
      for (var feed1 in hops[SSB.net.id]) {
        if (hops[SSB.net.id][feed1] == 1) {
          SSB.net.ebt.request(feed1, true)
          for (var feed2 in hops[feed1])
            if (hops[feed1][feed2] == 1 && !blocking.includes(feed2))
              SSB.net.ebt.request(feed2, true)
        }
      }

      SSB.net.ebt.startEBT(rpc)
    })
  })
}
