/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

// TODO: update address
const WEOS_ADDRESS = '0x6ccc5ad199bf1c64b50f6e7dd530d71402402eb6'
const USDC_WEOS_PAIR = '0x841499ee6126498dd220e8f60d138c8a1e217c20'

export function getEthPriceInUSD(): BigDecimal {
  // fetch mnt prices for each stablecoin
  let usdtPair = Pair.load(USDC_WEOS_PAIR) // usdc is token0

  if (usdtPair !== null) {
    return usdtPair.token0Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  // TODO: update address
  '0xd61551b3e56343b6d9323444cf398f2fdf23732b', // USDT
  '0x6ccc5ad199bf1c64b50f6e7dd530d71402402eb6', // WEOS
  '0x4ceac0a4104d29f9d5f97f34b1060a98a5eaf21d', // USDC
  // '0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111', // WETH

  // '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WEOS
  // '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  // '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC
  // '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
  // '0xd74f5255d557944cf7dd0e45ff521520002d5748', // USDs
  // '0x912ce59144191c1204e64559fe8253a0e49e6548', // ARB
  // '0x1622bf67e6e5747b81866fe0b85178a93c7f86e3', // UMAMI
  // '0x6c2c06790b3e3e3c38e12ee22f8183b37a13ee55', // DPX
  // '0x5979d7b546e38e414f7e9822514be443a4800529', // wstMNT
  // '0x6CDA1D3D092811b2d48F7476adb59A6239CA9b95', // stafi-rMNT
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('100')

// minimum liquidity for price to get trackedc
let MINIMUM_LIQUIDITY_THRESHOLD_MNT = BigDecimal.fromString('0.5')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived MNT (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WEOS_ADDRESS) {
    return ONE_BD
  }

  let price = ZERO_BD
  let lastPairReserveMNT = MINIMUM_LIQUIDITY_THRESHOLD_MNT
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveMNT.gt(lastPairReserveMNT)) {
        let token1 = Token.load(pair.token1)
        lastPairReserveMNT = pair.reserveMNT
        price = pair.token1Price.times(token1.derivedMNT as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveMNT.gt(lastPairReserveMNT)) {
        let token0 = Token.load(pair.token0)
        lastPairReserveMNT = pair.reserveMNT
        price = pair.token0Price.times(token0.derivedMNT as BigDecimal) // return token0 per our token * MNT per token 0
      }
    }
  }
  return price // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedMNT.times(bundle.mntPrice)
  let price1 = token1.derivedMNT.times(bundle.mntPrice)

  // d'ont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedMNT.times(bundle.mntPrice)
  let price1 = token1.derivedMNT.times(bundle.mntPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
