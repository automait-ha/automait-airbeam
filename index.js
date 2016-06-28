module.exports = init

var Emitter = require('events').EventEmitter
  , async = require('async')
  , request = require('request')
  , pluck = require('lodash.pluck')
  , parseXml = require('xml2js').parseString

function init(callback) {
  callback(null, 'airbeam', AirBeam)
}

function AirBeam(automait, logger, config) {
  Emitter.call(this)
  this.automait = automait
  this.logger = logger
  this.config = config
  this.currentState = {}
}

AirBeam.prototype = Object.create(Emitter.prototype)

AirBeam.prototype.init = function () {
  pollForChanges.call(this)
}

AirBeam.prototype.toggleLight = function (deviceName, state, cb) {
  var device = this.config.devices[deviceName]
  if (!device) return cb()
  var url = 'http://user:' + device.password + '@' + device.ip + '/service/camera/configure?torchMode=' + state
  request(url, function (error) {
    if (error) {
      this.logger.error(error)
      return cb(error)
    }
    cb()
  })
}

AirBeam.prototype.flashLight = function (deviceName, cb) {
  var device = this.config.devices[deviceName]
  if (!device) return cb()
  this.toggleLight(deviceName, 'on', function (error) {
    if (error) return cb(error)
    setTimeout(function () {
      this.toggleLight(deviceName, 'off', cb)
    }.bind(this), 500)
  }.bind(this))
}

AirBeam.prototype.isRecording = function (deviceName, cb) {
  var device = this.config.devices[deviceName]
  if (!device) return cb(null, false)
  cb(null, this.currentState[deviceName].recording)
}

AirBeam.prototype.startMotionRecorder = function (deviceName, cb) {
  setRecorderMode.call(this, deviceName, 'detection', function (error) {
    if (error) return cb(error)
    toggleRecorder.call(this, deviceName, 'start', function (error) {
      if (error) return cb(error)
      cb()
    })
  }.bind(this))
}

AirBeam.prototype.stopRecorder = function (deviceName, cb) {
  toggleRecorder.call(this, deviceName, 'stop', cb)
}

function setRecorderMode (deviceName, mode, cb) {
  var device = this.config.devices[deviceName]
  if (!device) return cb()
  var url = 'http://user:' + device.password + '@' + device.ip + '/service/recorder/configure?mode=' + mode
  request(url, function (error) {
    if (error) {
      this.logger.error(error)
      return cb(error)
    }
    cb()
  })
}

function toggleRecorder (deviceName, state, cb) {
  var device = this.config.devices[deviceName]
  if (!device) return cb()
  var url = 'http://user:' + device.password + '@' + device.ip + '/service/recorder/' + state
  request(url, function (error) {
    if (error) {
      this.logger.error(error)
      return cb(error)
    }
    cb()
  })
}

function pollForChanges () {
  setInterval(function () {
    async.each(Object.keys(this.config.devices), function (deviceName, cb) {
      var device = this.config.devices[deviceName]
        , url = 'http://user:' + device.password + '@' + device.ip + '/status'

      request(url, function (error, res, body) {
        if (error) {
          this.logger.error(error)
          return cb(error)
        }
        parseXml(body, function (error, result) {
          if (error) {
            this.logger.error('Error parsing XML: ' + error)
            return cb(error)
          }
          var status = parseStatus(result)
            , current = this.currentState[deviceName]

          if (!current) {
            current = { audioDetected: 'no', motionDetected: 'no' }
          }

          emitEvents.call(this, current, status, deviceName, 'audioDetected')
          emitEvents.call(this, current, status, deviceName, 'motionDetected')

          this.emit(deviceName + ':' + 'audioLevel' + ':update', (parseFloat(status.audioLevel, 10) * 100).toFixed(2))
          this.emit(deviceName + ':' + 'motionLevel' + ':update', (parseFloat(status.motionLevel, 10) * 100).toFixed(2))

          current.recording = status.state !== 'idle'
          this.currentState[deviceName] = current
          cb()
        }.bind(this))
      }.bind(this))
    }.bind(this))
  }.bind(this), this.config.pollInterval || 1000)
}

function emitEvents (current, status, deviceName, property) {
  var now = (new Date()).getTime()
    , changed = current[property] !== status[property]
    , timeoutReached = !current[property + 'Start'] || now - current[property + 'Start'] >= 5000

  if (changed && status[property] === 'yes' && timeoutReached) {
    this.emit(deviceName + ':' + property + ':start')
    current[property] = status[property]
  } else if (changed && status[property] === 'no' && timeoutReached) {
    this.emit(deviceName + ':' + property + ':stop')
    current[property] = status[property]
    current[property + 'Start'] = null
  }

  if (status[property] === 'yes') {
    current[property + 'Start'] = (new Date()).getTime()
  }
}

function parseStatus (data) {
  var status = {}
    , properties = pluck(data.properties.property, '$')

  properties.forEach(function (prop) {
    status[prop.name] = prop.value
  })

  return status
}
