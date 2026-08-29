/**
 * Deliverable manifests for our completed ERC-8183 jobs, chain 97.
 *
 * Public data: each was submitted on chain and its keccak256 is stored in
 * job.deliverable. Committed so the VERIFY block has something to hash without
 * a round-trip, and so a reader can diff this file against the chain.
 *
 * Canonicalisation is uniform — see lib/verify.ts. There is no per-job flag:
 * the raw-UTF-8 path was measured to reproduce all five hashes.
 */
export interface Deliverable { hash: string; manifest: Record<string, unknown> }

export const DELIVERABLES: Record<string, Deliverable> = {
  "748": {
    "hash": "0xac4c18558a1c73251ecde27d77395bf4ed499a417980f15e984b31253fc43974",
    "manifest": {
      "chain_id": 97,
      "contracts": {
        "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
        "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
        "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25"
      },
      "job_id": 748,
      "metadata": {
        "agent": "venus-health-factor-monitor",
        "agent_id": "2012",
        "analysed_block": 118745726,
        "analysed_chain": 56
      },
      "response": {
        "content": "{\"account\":\"0xb76b35db3f2a7d8346013d9b02edbf756cf27c72\",\"chainId\":56,\"chainLabel\":\"BNB Smart Chain mainnet\",\"blockNumber\":118745726,\"healthFactor\":1.9022,\"riskLevel\":\"HEALTHY\",\"collateralUsd\":28504.103269,\"weightedCollateralUsd\":22152.163851,\"borrowPowerUsd\":20503.11963,\"borrowedUsd\":11644.942834,\"avgLiquidationThreshold\":0.7771570163761449,\"priceDropToLiquidation\":0.4742929239827568,\"recommendation\":\"Health factor is 1.9022, a comfortable buffer — collateral would have to fall 47.4% before liquidation. No action needed; re-check if you borrow more or markets move sharply.\",\"markets\":[{\"symbol\":\"vBNB\",\"supplyUsd\":8295.289385,\"borrowUsd\":0,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8},{\"symbol\":\"vBTC\",\"supplyUsd\":13725.97474,\"borrowUsd\":0,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8},{\"symbol\":\"vADA\",\"supplyUsd\":1079.941074,\"borrowUsd\":0,\"collateralFactor\":0,\"liquidationThreshold\":0.63},{\"symbol\":\"vDOT\",\"supplyUsd\":52.065666,\"borrowUsd\":0,\"collateralFactor\":0,\"liquidationThreshold\":0},{\"symbol\":\"vUSDT\",\"supplyUsd\":0.002214,\"borrowUsd\":11644.942834,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8},{\"symbol\":\"vLINK\",\"supplyUsd\":1216.425545,\"borrowUsd\":0,\"collateralFactor\":0,\"liquidationThreshold\":0.63},{\"symbol\":\"vXRP\",\"supplyUsd\":567.191123,\"borrowUsd\":0,\"collateralFactor\":0.5,\"liquidationThreshold\":0.65},{\"symbol\":\"vSOL\",\"supplyUsd\":1675.065462,\"borrowUsd\":0,\"collateralFactor\":0.65,\"liquidationThreshold\":0.72},{\"symbol\":\"vETH\",\"supplyUsd\":1892.148057,\"borrowUsd\":0,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8}]}",
        "content_type": "application/json"
      },
      "version": 1
    }
  },
  "757": {
    "hash": "0x9265db4ab38322fd1b76bd704b1cbfcd023356f0d154bc6ca909c0c9bd4bd5e9",
    "manifest": {
      "chain_id": 97,
      "contracts": {
        "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
        "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
        "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25"
      },
      "job_id": 757,
      "metadata": {
        "agent": "PancakeSwap V3 Rebalancing Monitor",
        "agent_id": "2013",
        "analysed_chain": 56,
        "category": "rebalancing"
      },
      "response": {
        "content": "{\"tokenId\":\"6801109\",\"pool\":\"0x7e58f160b5b77b8b24cd9900c09a3e730215ac47\",\"fee\":500,\"token0\":{\"address\":\"0x000ae314e2a2172a039b26378814c252734f556a\",\"symbol\":\"ASTER\",\"decimals\":18},\"token1\":{\"address\":\"0x55d398326f99059ff775485246999027b3197955\",\"symbol\":\"USDT\",\"decimals\":18},\"tickLower\":47100,\"tickUpper\":48040,\"currentTick\":-3579,\"inRange\":false,\"liquidity\":\"5227473592648299221393621\",\"priceCurrent\":0.6991587214055577,\"priceLower\":111.02601194421,\"priceUpper\":121.96813425826302,\"amount0\":22776.66740000344,\"amount1\":0,\"uncollectedFees0\":0,\"uncollectedFees1\":0,\"tokensOwed0\":0,\"tokensOwed1\":0,\"rangeWidthPct\":1565.041238712644,\"distanceToEdgePct\":0,\"recommendedLower\":-4050,\"recommendedUpper\":-3110,\"recommendation\":\"OUT OF RANGE — price is below the position's band, so it is earning NO fees and sits entirely in ASTER. Re-centre to ticks [-4050, -3110] (same width, centred on the current tick -3579) to resume earning. Re-entering realises the divergence loss already incurred; holding does not recover it while out of range.\",\"blockNumber\":118754877}",
        "content_type": "application/json"
      },
      "version": 1
    }
  },
  "754": {
    "hash": "0x7923d665c028295136f83593a8afef43b420ad81d8e69c3bef6eaaa9c1af9600",
    "manifest": {
      "chain_id": 97,
      "contracts": {
        "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
        "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
        "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25"
      },
      "job_id": 754,
      "metadata": {
        "agent": "Grid Trading Parameter Advisor",
        "agent_id": "2014",
        "analysed_chain": 56,
        "category": "grid-trading"
      },
      "response": {
        "content": "{\"pool\":\"0x36696169c63e42cd08ce11f5deebbcebae652050\",\"pair\":\"USDT/WBNB\",\"feeTierPct\":0.05,\"blockNumber\":118754687,\"windowHours\":15,\"samples\":15,\"currentPrice\":0.001450171865292413,\"twapPrice\":0.0014515299952656815,\"hourlyVolPct\":0.15608534496373744,\"annualisedVolPct\":14.608787829010744,\"observedLowPrice\":0.001445752265937178,\"observedHighPrice\":0.0014543471821683578,\"poolLiquidity\":\"3203830264900345723174695\",\"lowerBound\":0.0014327443892389832,\"upperBound\":0.0014678113239743379,\"gridCount\":15,\"capitalPerLevelUsd\":666.6666666666666,\"gridSpacingPct\":0.15608534496373744,\"expectedFillsPerDay\":4.898979485566356,\"recommendation\":\"Over the last 15h the USDT/WBNB 0.05% pool realised 0.1561% hourly volatility (14.6% annualised), trading between 0.00144575 and 0.00145435. A grid from 0.00143274 to 0.00146781 (+/-2 sigma) with 15 levels spaced 0.156% apart puts $666.67 at each level. At the measured volatility that is roughly 4.9 level-crossings per day. Grid trading loses money in a sustained trend — if price leaves the band you hold the losing side, so treat the bounds as a stop, not a suggestion.\",\"dataWindow\":\"15h of hourly TWAPs from pool.observe() (24h requested; oracle retained 15h), 15 samples, ending at block 118754687\",\"assumptions\":[\"volatility is REALISED over the stated window only — it is not a forecast\",\"bounds are +/-2 sigma assuming log-normal returns; crypto returns are fat-tailed, so breaches are more likely than 5%\",\"expected fills are a crossings estimate from realised vol / grid spacing, NOT a backtest — no historical fill simulation was run\",\"capital per level is a naive equal split; no inventory or fee modelling\",\"pool fee tier 0.05% is charged per fill and is not netted out of the estimate\"]}",
        "content_type": "application/json"
      },
      "version": 1
    }
  },
  "753": {
    "hash": "0x58bb1271cb01d9a061d23caacf5064c621c88f77fed2c634a2ce199d31195c97",
    "manifest": {
      "chain_id": 97,
      "contracts": {
        "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
        "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
        "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25"
      },
      "job_id": 753,
      "metadata": {
        "agent": "BSC Yield Route Optimiser",
        "agent_id": "2015",
        "analysed_chain": 56,
        "category": "yield-optimisation"
      },
      "response": {
        "content": "{\"asset\":\"BTCB\",\"chainId\":56,\"blockNumber\":118754715,\"venues\":[{\"venue\":\"Lista\",\"asset\":\"BTCB\",\"supplyAprPct\":0.9986887011612124,\"spot\":false,\"method\":\"ERC-4626 share-price growth over 2000000 blocks, annualised (REALISED, not spot)\",\"detail\":{\"sharePriceNow\":\"1003835908989386159\",\"sharePriceThen\":\"1003549778796098704\",\"windowDays\":\"10.42\",\"fromBlock\":116754717,\"toBlock\":118754717}},{\"venue\":\"Venus\",\"asset\":\"BTCB\",\"supplyAprPct\":0.17894622451199999,\"spot\":true,\"method\":\"supplyRatePerBlock() x interestRateModel.blocksPerYear()\",\"detail\":{\"supplyRatePerBlock\":\"25534564\",\"blocksPerYear\":\"70080000\",\"interestRateModel\":\"0x7d47671514a1b13f0e376d70fcf13b2eb2694c3a\"}},{\"venue\":\"Aave V3\",\"asset\":\"BTCB\",\"supplyAprPct\":0.02006810429773286,\"spot\":true,\"method\":\"Pool.getReserveData(asset).currentLiquidityRate (ray)\",\"detail\":{\"currentLiquidityRate\":\"200681042977328585351671\",\"ray\":\"1e27\"}}],\"best\":{\"venue\":\"Lista\",\"asset\":\"BTCB\",\"supplyAprPct\":0.9986887011612124,\"spot\":false,\"method\":\"ERC-4626 share-price growth over 2000000 blocks, annualised (REALISED, not spot)\",\"detail\":{\"sharePriceNow\":\"1003835908989386159\",\"sharePriceThen\":\"1003549778796098704\",\"windowDays\":\"10.42\",\"fromBlock\":116754717,\"toBlock\":118754717}},\"gasCostToSwitchTBnb\":0.0000225,\"gasCostUsd\":0.0154575,\"breakEvenDays\":0.05765244996971052,\"positionSizeUsd\":10000,\"recommendation\":\"Move to Lista at 0.9987% (from Aave V3 at 0.0201%). On $10,000 the spread is $97.86/yr against $0.02 of gas; break-even in 0.1 days. Worth it if you hold longer than that.\",\"assumptions\":[\"gas: 450000 units for withdraw+approve+deposit at the live eth_gasPrice\",\"BNB priced at $687 for the gas conversion\",\"Lista's figure is a REALISED trailing APR from share-price growth (no spot-rate getter exists); Venus and Aave are spot rates\",\"break-even assumes rates hold constant, which they do not\"]}",
        "content_type": "application/json"
      },
      "version": 1
    }
  },
  "765": {
    "hash": "0xe5d51d1201cffcde729f931ac8f6680bcc4116618c3c21c421d71b2d5a4818bc",
    "manifest": {
      "chain_id": 97,
      "contracts": {
        "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
        "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
        "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25"
      },
      "job_id": 765,
      "metadata": {
        "agent": "BSC Yield Route Optimiser",
        "agent_id": "2015",
        "analysed_chain": 56,
        "category": "yield-optimisation"
      },
      "response": {
        "content": "{\"asset\":\"BTCB\",\"chainId\":56,\"blockNumber\":118762120,\"venues\":[{\"venue\":\"Lista\",\"asset\":\"BTCB\",\"supplyAprPct\":0.9957785419553083,\"spot\":false,\"method\":\"ERC-4626 share-price growth over 2000000 blocks, annualised (REALISED, not spot)\",\"detail\":{\"sharePriceNow\":\"1003836334062539277\",\"sharePriceThen\":\"1003551037289226136\",\"windowDays\":\"10.42\",\"fromBlock\":116762123,\"toBlock\":118762123}},{\"venue\":\"Venus\",\"asset\":\"BTCB\",\"supplyAprPct\":0.17899199376,\"spot\":true,\"method\":\"supplyRatePerBlock() x interestRateModel.blocksPerYear()\",\"detail\":{\"supplyRatePerBlock\":\"25541095\",\"blocksPerYear\":\"70080000\",\"interestRateModel\":\"0x7d47671514a1b13f0e376d70fcf13b2eb2694c3a\"}},{\"venue\":\"Aave V3\",\"asset\":\"BTCB\",\"supplyAprPct\":0.020068067620425806,\"spot\":true,\"method\":\"Pool.getReserveData(asset).currentLiquidityRate (ray)\",\"detail\":{\"currentLiquidityRate\":\"200680676204258071579667\",\"ray\":\"1e27\"}}],\"best\":{\"venue\":\"Lista\",\"asset\":\"BTCB\",\"supplyAprPct\":0.9957785419553083,\"spot\":false,\"method\":\"ERC-4626 share-price growth over 2000000 blocks, annualised (REALISED, not spot)\",\"detail\":{\"sharePriceNow\":\"1003836334062539277\",\"sharePriceThen\":\"1003551037289226136\",\"windowDays\":\"10.42\",\"fromBlock\":116762123,\"toBlock\":118762123}},\"gasCostToSwitchTBnb\":0.0000225,\"gasCostUsd\":0.0154575,\"breakEvenDays\":0.057824402303828924,\"positionSizeUsd\":10000,\"recommendation\":\"Move to Lista at 0.9958% (from Aave V3 at 0.0201%). On $10,000 the spread is $97.57/yr against $0.02 of gas; break-even in 0.1 days. Worth it if you hold longer than that.\",\"assumptions\":[\"gas: 450000 units for withdraw+approve+deposit at the live eth_gasPrice\",\"BNB priced at $687 for the gas conversion\",\"Lista's figure is a REALISED trailing APR from share-price growth (no spot-rate getter exists); Venus and Aave are spot rates\",\"break-even assumes rates hold constant, which they do not\"]}",
        "content_type": "application/json"
      },
      "version": 1
    }
  }
} as unknown as Record<string, Deliverable>;

export const deliverableFor = (jobId: string): Deliverable | undefined => DELIVERABLES[jobId];
