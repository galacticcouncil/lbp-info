//@ts-check

const defaultDiagramWidth = 900;
const defaultDiagramHeight = 400;
const diagramId = "price-prediction";
const poolAddress = "0xbfb4b21887ebb3542bde0a9997d481debc6e072b"; // perp
// const poolAddress = "0x38131a37f74a52141e14d7aef40a876066ffe25f" // tap
// const poolAddress = "0x86eca06d0f1fec418fac3bd3ef5382a9f8981f0d" // apy
// const poolAddress = "0xc99317ceef9ed2ab9ff0ec99f64f3dd61b09a6b2" // furucombo
const daiAddress = "0xax0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const xhdxAddress = "0xbC396689893D065F41bc2C6EcbeE5e0085233447";
const graphApi =
  "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer";
const stablecoin = "USDC"; // perp
// const stablecoin = 'DAI'; // tap

const bucket = 1600;
const params = {
  start: {
    time: 1599628888,
    weights: [9, 1],
    balances: [7500000, 1333333],
  },
  end: {
    time: 1599904979,
    weights: [3, 7],
  },
};
let balances = params.start.balances;

const series = { data: [] };
const swaps = [];

const weights = (() => {
  const start = params.start.weights;
  const end = params.end.weights;
  let time = params.start.time;
  const res = {
    [time]: start,
    [params.end.time]: end,
  };
  const steps = Math.ceil((params.end.time - params.start.time) / bucket);
  for (let i = 1; i < steps; i++) {
    time += bucket;
    res[time] = [
      start[0] - (i / steps) * (start[0] - end[0]),
      start[1] + (i / steps) * (end[1] - start[1]),
    ];
  }
  return res;
})();

const currentBucket = () => series.data[series.data.length - 1].time;

function spotPrice(balances, w, lotSize = 2000, fee = 0.001 / 100) {
  return (
    (balances[1] *
      (Math.pow(balances[0] / (balances[0] - lotSize), w[0] / w[1]) - 1)) /
    (1 - fee) /
    lotSize
  );
}

function saleRate(lastBuckets = 10) {
  return (
    (-1 *
      swaps
        .filter((s) => s.timestamp + bucket * 10 > currentBucket())
        .reduce((a, { deltas }) => a + deltas[0], 0)) /
    lastBuckets
  );
}

async function fetchPool() {
  return fetch(graphApi, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
                query {
                  pools(where: {id: "${poolAddress}"}) {
                    swapsCount,
                    tokens {
                      symbol
                      balance
                      denormWeight
                    },
                    holdersCount
                  }
                }
            `,
    }),
  })
    .then((res) => res.json())
    .then((res) => res.data.pools[0]);
}

async function fetchSwaps(skip = 0) {
  return fetch(graphApi, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
                query {
                  pools(where: {id: "${poolAddress}"}) {
                    swaps(first: 1000, skip: ${skip}, orderBy: timestamp, orderDirection: asc) {
                      timestamp
                      id
                      tokenIn
                      tokenInSym
                      tokenAmountIn
                      tokenOut
                      tokenOutSym
                      tokenAmountOut
                      userAddress {
                        id
                      }
                    }
                  }
                }
            `,
    }),
  })
    .then((res) => res.json())
    .then((res) => res.data.pools[0].swaps.map(calculateSwap));
}

function calculateSwap(swap) {
  const tokenAmountIn = Number(swap.tokenAmountIn);
  const tokenAmountOut = Number(swap.tokenAmountOut);
  let price, deltas;
  if (swap.tokenInSym === stablecoin) {
    price = tokenAmountIn / tokenAmountOut;
    deltas = [-tokenAmountOut, tokenAmountIn];
  } else {
    price = tokenAmountOut / tokenAmountIn;
    deltas = [tokenAmountIn, -tokenAmountOut];
  }
  return { ...swap, price, deltas };
}

async function fetchAllSwaps(count) {
  let i = 0;
  let calls = [];
  do {
    calls.push(fetchSwaps(i));
    i += 1000;
  } while (i < count);
  return Promise.all(calls).then((calls) => calls.flat());
}

function predictPrice(rate = 0) {
  const swaps = series.data;
  const { time } = swaps[swaps.length - 1];
  const b = [...balances];
  let over = false;
  const lastPrice = series.data[series.data.length - 1].close;
  const future = [{ time, value: lastPrice }];
  for (let i = time + bucket; i < params.end.time; i += bucket) {
    let price = spotPrice(b, weights[i]);
    if (price > lastPrice * 2) {
      price = undefined;
      over = true;
    }
    future.push({ time: i, value: price });
    if (rate) {
      b[0] -= rate;
      b[1] += rate * spotPrice(b, weights[i], rate);
    }
  }
  return future;
}

function updatePrice(swap) {
  const render = !!series.candle;
  const bar = series.data[series.data.length - 1];
  const { timestamp, price } = swap;
  if (!bar || timestamp >= bar.time + bucket) {
    const newBar = {};
    newBar.open = bar ? bar.close : price;
    newBar.high = price;
    newBar.low = price;
    newBar.close = price;
    newBar.time = bar ? bar.time + bucket : timestamp;
    series.data.push(newBar);
    if (render) {
      series.candle.setData(series.data);
    }
  } else {
    bar.close = price;
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    if (render) {
      series.candle.update(bar);
    }
  }
  balances = balances.map((b, i) => b + swap.deltas[i]);
  swaps.push(swap);
  if (render) {
    series.predicted.setData(predictPrice(saleRate()));
    series.worstCase.setData(predictPrice());
  }
}

async function getLatestPrice() {
  const abi = [
    "function getSpotPrice(address tokenIn, address tokenOut) view returns (uint)",
  ];
  const provider = ethers.getDefaultProvider();
  const pool = new ethers.Contract(poolAddress, abi, provider);
  const usdcDecimals = 6;
  const rawPrice = await pool.getSpotPrice(daiAddress, xhdxAddress);
  const price = Number.parseFloat(
    ethers.utils.formatUnits(rawPrice, usdcDecimals)
  );

  return price.toFixed(4);
}

function fetchCountdown(block) {
  const ETHERSCAN_APIKEY = "C9KKK6QF3REYE2UKRZKF5GFB2R2FQ5BWRE";
  const url =
    `https://api.etherscan.io/api` +
    `?module=block&action=getblockcountdown&` +
    `blockno=${block}&apikey=${ETHERSCAN_APIKEY}`;
  return fetch(url);
}

async function main() {
  const swaps = await fetchAllSwaps(5000);

  const half = (params.end.time - params.start.time) / 3 + params.start.time;
  const past = swaps.filter((s) => s.timestamp <= half);
  past.map(updatePrice);

  const next = swaps.filter((s) => s.timestamp > half);
  setInterval(() => updatePrice(next.shift()), 20);

  let chartWidth = defaultDiagramWidth;
  let chartHeight = defaultDiagramHeight;

  if (document.scrollingElement.clientWidth - 32 < defaultDiagramWidth) {
    chartWidth = document.scrollingElement.clientWidth - 32;
    chartHeight =
      ((chartWidth - 32) * defaultDiagramHeight) / (defaultDiagramWidth - 32);
  }

  const chart = LightweightCharts.createChart(
    document.getElementById(diagramId),
    {
      width: chartWidth,
      height: chartHeight,
      layout: {
        textColor: "#F653A2",
        backgroundColor: "#0D106E",
      },
      timeScale: {
        lockVisibleTimeRangeOnResize: true,
        timeVisible: true,
        barSpacing: 1,
      },
      priceScale: {
        scaleMargins: {
          top: 0.1,
          bottom: 0,
        },
      },
      grid: {
        vertLines: {
          color: "transparent",
        },
        horzLines: {
          color: "transparent",
        },
      },
    }
  );

  series.chart = chart;

  series.candle = chart.addCandlestickSeries({
    upColor: "#5EAFE1",
    wickUpColor: "#5EAFE1",
    downColor: "#F653A2",
    wickDownColor: "#F653A2",
    borderVisible: false,
    wickVisible: true,
  });
  series.candle.setData(series.data);

  series.worstCase = chart.addLineSeries({
    lineStyle: 4,
    priceLineVisible: false,
    lastValueVisible: false,
    color: "#F653A2",
    lineWidth: 1,
  });
  const predicted = predictPrice();
  series.worstCase.setData(predicted);

  series.predicted = chart.addLineSeries({
    lineStyle: 4,
    priceLineVisible: false,
    lastValueVisible: false,
    color: "#5EAFE1",
    lineWidth: 1,
  });
  series.predicted.setData(predictPrice(saleRate()));

  chart.timeScale().setVisibleRange({
    from: params.start.time,
    to: params.end.time,
  });

  window.addEventListener("resize", () => {
    console.log("aaa");
    if (document.scrollingElement.clientWidth - 32 < defaultDiagramWidth) {
      chart.applyOptions({
        width: document.scrollingElement.clientWidth - 32,
        height:
          ((document.scrollingElement.clientWidth - 32) *
            defaultDiagramHeight) /
          (defaultDiagramWidth - 32),
      });
    } else {
      chart.applyOptions({
        width: defaultDiagramWidth,
        height: defaultDiagramHeight,
      });
    }
  });
}

main();
