# GTA VI Trophy Rarity Forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/jingoa8536-ai/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/jingoa8536-ai/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

This deterministic Node 22 forecaster models Exophase's tracked players and trophy earners separately, fits their adoption curves in log-time, and produces refresh-aware quantiles on the logit scale. Frozen launch-night pages receive a bounded dilution prior, while later refreshes contribute fit residual and jump risk to each trophy's spread.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

[Join make.fun with a referral](https://make.fun/?ref=bt2b09sd&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
