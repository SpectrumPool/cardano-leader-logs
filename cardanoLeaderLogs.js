const fs                      = require('fs')

const chainStats     = require('./nodeUtils.js')
const { callCLIForJSON }      = require('./cliUtils.js')
const { getSigma }            = require('./ledgerUtils.js')

console.log('             process args:', process.argv)

if(process.argv.length < 4) {
  
  throw Error('Usage: node cardanoLeaderLogs.js path/to/leaderlogs.config epochNonce')
}

let overwriteDFactor = -1.0

if(process.argv.length >= 6 && !isNaN(parseFloat(process.argv[5]))) {

  overwriteDFactor = parseFloat(process.argv[5])
}

const params                  = JSON.parse(fs.readFileSync(process.argv[2]))

if(
  !params.hasOwnProperty('poolId') ||
  !params.hasOwnProperty('vrfSkey') ||
  !params.hasOwnProperty('genesisShelley') ||
  !params.hasOwnProperty('genesisByron') ||
  !params.hasOwnProperty('ledgerState') ||
  !params.hasOwnProperty('libsodiumBinary') ||
  !params.hasOwnProperty('nodeStatsURL') ||
  !params.hasOwnProperty('cardanoCLI') ||
  !params.hasOwnProperty('timeZone')
) {

  throw Error('Invalid leaderLogsConfig.json')
}

const cardanoCLI              = params.cardanoCLI

const epochNonce              = process.argv[3]
const lastEpoch               = process.argv.length >= 5 && process.argv[4] === '1'

console.log('     replaying last epoch:', lastEpoch)

const poolId                  = params.poolId
const timeZone                = params.timeZone
const vrfSkey                 = JSON.parse(fs.readFileSync(params.vrfSkey)).cborHex
const genesisShelley          = JSON.parse(fs.readFileSync(params.genesisShelley))
const genesisByron            = JSON.parse(fs.readFileSync(params.genesisByron))

async function loadLedgerState(magicString) {
  return await callCLIForJSON(cardanoCLI + ' shelley query ledger-state --cardano-mode ' + magicString)
}


function getLedger(ledgerFile){
  if(ledgerFile === null) {
    console.log('Loading ledger state from cardano-node')
    ledger = await loadLedgerState(magicString)
  } else {
    try {
      ledger = JSON.parse(fs.readFileSync(ledgerFile))
    } catch(e) {
      console.log('Could not load ledger state from config.')
      console.log(e.message)
      process.exit(1)
    }
  }
}

function getLeaderLogs(firstSlotOfEpoch, poolVrfSkey, sigma, d, timeZone) {
  
  let slots = await callCLIForJSON('python3 ./isSlotLeader.py' +
    ' --first-slot-of-epoch ' + firstSlotOfEpoch +
    ' --epoch-nonce '         + epochNonce +
    ' --vrf-skey '            + poolVrfSkey +
    ' --sigma '               + sigma +
    ' --d '                   + d +
    ' --epoch-length '        + genesisShelley.epochLength +
    ' --active-slots-coeff '  + genesisShelley.activeSlotsCoeff +
    ' --libsodium-binary '    + params.libsodiumBinary +
    ' --time-zone '           + timeZone
  )

  let expectedBlocks = (sigma * 21600 * (1.00 - d))

  console.log('')
  console.log('expected blocks with d == ' + d.toFixed(2) + ':', expectedBlocks.toFixed(2))
  console.log('assigned blocks with d == ' + d.toFixed(2) + ':', slots.length, 'max performance:', (slots.length / expectedBlocks * 100).toFixed(2) + '%')
  console.log('')
  console.log(slots)
}

function main() {
  const magicString           = genesisShelley.networkId === 'Testnet' ?
    '--testnet-magic ' + genesisShelley.networkMagic :
    '--mainnet'

  console.log('                  Network:', magicString)
  console.log('     Loading ledger state:', params.ledgerState)

  let ledger                  = getLedger()

  console.log('                  Loading: protocol parameters')

  const protocolParameters    = await callCLIForJSON(cardanoCLI + ' shelley query protocol-parameters --cardano-mode ' + magicString)
  const tip                   = await callCLIForJSON(cardanoCLI + ' shelley query tip ' + magicString)

  let { getFirstSlotOfEpoch } = chainStats(nodeStatsURL);
  const absoluteSlot          = tip.slotNo - (lastEpoch ? genesisShelley.epochLength : 0)
  const firstSlotOfEpoch      = await getFirstSlotOfEpoch(genesisByron, genesisShelley, absoluteSlot)
  const sigma                 = await getSigma(poolId, ledger, lastEpoch)
  const poolVrfSkey           = vrfSkey.substr(4)
  const d = (parseFloat(protocolParameters.decentralisationParam) + (lastEpoch ? 0.02 : 0))

  console.log('         firstSlotOfEpoch:', firstSlotOfEpoch)
  console.log('                        d:', d)
  console.log('                    sigma:', sigma)

  await getLeaderLogs(firstSlotOfEpoch, poolVrfSkey, sigma, d, timeZone)

  if(overwriteDFactor >= 0.0) {
    await getLeaderLogs(firstSlotOfEpoch, poolVrfSkey, sigma, overwriteDFactor)
  }
}

main()
