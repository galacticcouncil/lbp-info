//@ts-check

const defaultDiagramWidth = 900
const defaultDiagramHeight = 400
const diagramId = "price-prediction"
const poolAddress = "0xbfb4b21887ebb3542bde0a9997d481debc6e072b" // perp
// const poolAddress = "0x38131a37f74a52141e14d7aef40a876066ffe25f" // tap
// const poolAddress = "0x86eca06d0f1fec418fac3bd3ef5382a9f8981f0d" // apy
// const poolAddress = "0xc99317ceef9ed2ab9ff0ec99f64f3dd61b09a6b2" // furucombo
const daiAddress = "0xax0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
const xhdxAddress = "0xbC396689893D065F41bc2C6EcbeE5e0085233447"
const graphApi = 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer';
const stablecoin = 'USDC'; // perp
// const stablecoin = 'DAI'; // tap

const bucket = 1600;

const series = {};

function groupBy(xs, key) {
    return xs.reduce(function(rv, x) {
        (rv[x[key]] = rv[x[key]] || []).push(x);
        return rv;
    }, {});
}

async function fetchPool() {
    return fetch(graphApi, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
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
    }).then(res => res.json()).then(res => res.data.pools[0])
}

async function fetchSwaps(skip = 0) {
    return fetch(graphApi, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
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
    }).then(res => res.json()).then(res => res.data.pools[0].swaps.map(swap => ({...swap, price: swapPrice(swap)})))
}

function swapPrice({tokenAmountIn, tokenAmountOut, tokenInSym}) {
    return tokenInSym === stablecoin
        ? Number(tokenAmountIn) / Number(tokenAmountOut)
        : Number(tokenAmountOut) / Number(tokenAmountIn);
}

async function fetchAllSwaps(count) {
    let i = 0;
    let calls = [];
    do {
        calls.push(fetchSwaps(i));
        i += 1000;
    } while (i < count);
    return Promise.all(calls).then(calls => calls.flat())
}

function swapsToSeries(swaps) {
    const byTimestamp = groupBy(swaps, 'timestamp');
    const series = [];
    Object.values(byTimestamp).forEach(swaps => {
       swaps.sort((a, b) => b.price - a.price);
       series.push({ time: swaps[0].timestamp, value: swaps[0].price });
    });
    series.sort((a, b) => a.time - b.time);
    return series;
}

function swapsToCandles(swaps) {
    const byTimestamp = groupBy(swaps, 'timestamp');
    const timestamps = Object.keys(byTimestamp).sort();
    const from = Number(timestamps[0]);
    const to = Number(timestamps[timestamps.length - 1]);
    let candles = [];
    for (let i = from; i < to; i += bucket) {
        let s = timestamps.filter(t => t >= i && t < i + bucket)
            .map(t => byTimestamp[t])
            .flat()
            .sort((a, b) => a.time - b.time);
        const close = candles.length ? candles[candles.length - 1].close : s[0].price;
        if (s.length) {
            candles.push({
                time: i,
                open: close,
                high: Math.max(...s.map(t => t.price)),
                low: Math.min(...s.map(t => t.price)),
                close: s[s.length - 1].price
            });
        } else {
            candles.push({
                time: i,
                open: close,
                high: close,
                low: close,
                close,
            });
        }
    }
    return candles;
}

function predictPrice(coeficient = 1.02, endTime = 1599904979) {
    const swaps = series.data;
    const { time, close } = swaps[swaps.length - 1];
    const future = [{ time, value: close }];
    for (let i = time + bucket; i < endTime; i += bucket) {
        future.push({time: i, value: future[future.length - 1].value / coeficient});
    }
    return future;
}

function updatePrice(price, time = Number(new Date()) / 1000) {
    const bar = series.data[series.data.length - 1];
    if (time >= bar.time + bucket) {
        const newBar = {};
        newBar.open = bar.close;
        newBar.high = price;
        newBar.low = price;
        newBar.close = price;
        newBar.time = bar.time + bucket;
        series.data.push(newBar);
        series.candle.setData(series.data);
    } else {
        bar.close = price;
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        series.candle.update(bar);
    }
    series.predicted.setData(predictPrice(1.005));
    series.worstCase.setData(predictPrice());
}

async function getLatestPrice() {
    const abi = ["function getSpotPrice(address tokenIn, address tokenOut) view returns (uint)"]
    const provider = ethers.getDefaultProvider()
    const pool = new ethers.Contract(poolAddress, abi, provider)
    const usdcDecimals = 6
    const rawPrice = await pool.getSpotPrice(daiAddress, xhdxAddress)
    const price = Number.parseFloat(ethers.utils.formatUnits(rawPrice, usdcDecimals))

    return price.toFixed(4)
}

function fetchCountdown(block) {
    const ETHERSCAN_APIKEY = "C9KKK6QF3REYE2UKRZKF5GFB2R2FQ5BWRE"
    const url =
        `https://api.etherscan.io/api` +
        `?module=block&action=getblockcountdown&` +
        `blockno=${block}&apikey=${ETHERSCAN_APIKEY}`
    return fetch(url)
}

function getPrice(dai, daiWeight, xhdx, xhdxWeight) {
    return (
        Number.parseFloat(dai) /
        Number.parseFloat(daiWeight) /
        (Number.parseFloat(xhdx) / Number.parseFloat(xhdxWeight))
    )
}

async function main() {
    const provider = ethers.getDefaultProvider();
    const currentBlock = await provider.getBlockNumber();
    console.log({currentBlock});
    const pool = await fetchPool();
    const swaps = await fetchAllSwaps(Number(pool.swapsCount));
    let candles = swapsToCandles(swaps);
    console.log({swaps, pool, candles});

    // TODO remove
    candles = candles.slice(0, candles.length/2);

    series.data = candles;

    let chartWidth = defaultDiagramWidth
    let chartHeight = defaultDiagramHeight

    if (document.scrollingElement.clientWidth < defaultDiagramWidth) {
        chartWidth = document.scrollingElement.clientWidth
        chartHeight = (chartWidth * defaultDiagramHeight) / defaultDiagramWidth
    }

    var chart = LightweightCharts.createChart(document.getElementById(diagramId), {
        width: chartWidth,
        height: chartHeight,
        layout: {
            textColor: "#F653A2",
            backgroundColor: "#0D106E",
        },
        timeScale: {
            timeVisible: true,
            barSpacing: 1,
        },
        grid: {
            vertLines: {
                color: "transparent",
            },
            horzLines: {
                color: "transparent",
            },
        },
    });

    series.candle = chart.addCandlestickSeries({
        upColor: '#5EAFE1',
        wickUpColor: '#5EAFE1',
        downColor: '#F653A2',
        wickDownColor: '#F653A2',
        borderVisible: false,
        wickVisible: true,
    })
    series.candle.setData(candles);

    series.worstCase = chart.addLineSeries({
        color: '#F653A2',
        lineWidth: 1,
    });
    const predicted = predictPrice();
    series.worstCase.setData(predicted);

    series.predicted = chart.addLineSeries({
        color: '#5EAFE1',
        lineWidth: 1,
    });
    series.predicted.setData(predictPrice(1.005));


    chart.timeScale().setVisibleRange({
        from: Math.min(candles[0].time, predicted[0].time),
        to: Math.max(candles[candles.length-1].time, predicted[predicted.length-1].time),
    });

    console.log(chart.timeScale().options());
}

main()
