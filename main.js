//@ts-check

const fromBlock = 10_825_600
const toBlock = 10_846_450
const blockDuration = 15
const indexingInterval = 300
const defaultDiagramWidth = 600
const defaultDiagramHeight = 400
const PERP_START_WEIGHT = 9
const USDC_START_WEIGHT = 1
const PERP_END_WEIGHT = 3
const USDC_END_WEIGHT = 7
const latestPriceId = "latest-price"
const countdownId = "countdown"
const diagramId = "price-prediction"
const poolAddress = "0xbfb4b21887ebb3542bde0a9997d481debc6e072b"
const crpAddress = "0x91ACcD0BC2aAbAB1d1b297EB64C4774bC4e7bcCE" // perp
// const crpAddress = "0x64010f6ba757715D8f12d8317004425d73cA5a81" // tap
const usdcAddress = "0xax0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
const perpAddress = "0xbC396689893D065F41bc2C6EcbeE5e0085233447"

const timezoneOffset = new Date().getTimezoneOffset() * 60
const forecastPrices = [
    1.6,
    1.4632,
    1.346,
    1.2444,
    1.1556,
    1.0771,
    1.0074,
    0.945,
    0.8889,
    0.8381,
    0.7919,
    0.7498,
    0.7111,
    0.6756,
    0.6427,
    0.6123,
    0.5841,
    0.5579,
    0.5333,
    0.5104,
    0.4889,
    0.4687,
    0.4497,
    0.4317,
    0.4148,
    0.3988,
    0.3836,
    0.3692,
    0.3556,
    0.3425,
    0.3302,
    0.3183,
    0.3071,
    0.2963,
    0.286,
    0.2761,
    0.2667,
    0.2576,
    0.2489,
    0.2405,
    0.2325,
    0.2247,
    0.2173,
    0.2101,
    0.2032,
    0.1965,
    0.19,
    0.1838,
    0.1778,
    0.1719,
    0.1663,
    0.1608,
    0.1556,
    0.1504,
    0.1455,
    0.1406,
    0.1359,
    0.1314,
    0.127,
    0.1227,
    0.1185,
    0.1145,
    0.1105,
    0.1067,
    0.1029,
    0.0993,
    0.0957,
    0.0923,
    0.0889,
    0.0856,
    0.0824,
    0.0793,
    0.0762,
]

// generate historicData every 5 minutes (300 seconds)
function generateHistoricResult(from, fromBlock, currentBlock) {
    const result = []
    let prevUsdc = 0
    for (let i = 0; i < currentBlock - fromBlock; i++) {
        if ((i * blockDuration) % indexingInterval === 0) {
            const currentUsdc = prevUsdc + (Math.random() - 0.5) / 10
            result.push({
                block: i + fromBlock,
                timestamp: from.plus({ seconds: i * blockDuration }).toSeconds(),
                perpBalance: "1",
                usdcBalance: currentUsdc.toString(),
            })
            prevUsdc = currentUsdc
        }
    }
    return result
}

function fetchHistoricData() {
    const historicUrl =
        "https://u4zncle5mjdwdg5wutc66yg7di.appsync-api.ap-southeast-1.amazonaws.com/graphql"
    const historicApiKey = "da2-pzxqpxmtdjd4tjmqk2j7kdnube"

    return fetch(historicUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Api-Key": historicApiKey,
        },
        body: JSON.stringify({
            query: `
                query {
                    listPoolStatuses(query: {
                        poolAddr: { eq: "${crpAddress}" }
                    }, limit: 1000) {
                        items {
                            poolAddr
                            timestamp
                            blockNumber
                            perpBalance
                            usdcBalance
                            perpWeight
                            usdcWeight
                        }
                    }
                }
            `,
        }),
    }).then(res => res.json())
}

async function getLatestPrice() {
    const abi = ["function getSpotPrice(address tokenIn, address tokenOut) view returns (uint)"]
    const provider = ethers.getDefaultProvider()
    const pool = new ethers.Contract(poolAddress, abi, provider)
    const usdcDecimals = 6
    const rawPrice = await pool.getSpotPrice(usdcAddress, perpAddress)
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

function getPrice(usdcBalance, usdcWeight, perpBalance, perpWeight) {
    return (
        Number.parseFloat(usdcBalance) /
        Number.parseFloat(usdcWeight) /
        (Number.parseFloat(perpBalance) / Number.parseFloat(perpWeight))
    )
}

async function main() {
    const provider = ethers.getDefaultProvider()
    // const blockNumber = await provider.getBlockNumber()
    // console.log("real block number", blockNumber)
    const currentBlock = await provider.getBlockNumber()
    console.log({currentBlock});
    const forecastData = []
    const now = new luxon.DateTime.local()
    const totalBlock = toBlock - fromBlock
    const currentHour = Math.floor(((currentBlock - fromBlock) * blockDuration) / 60 / 60)
    const from = now.minus({ seconds: (currentBlock - fromBlock) * blockDuration })
    const to = from.plus({ seconds: totalBlock * blockDuration })

    const res = await fetchHistoricData()
    const {
        data: {
            listPoolStatuses: { items: historicResult },
        },
    } = res
    // const historicResult = generateHistoricResult(from, fromBlock, currentBlock)
    const historicData = historicResult
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(({ timestamp, usdcBalance, usdcWeight, perpBalance, perpWeight }) => ({
            time: timestamp - timezoneOffset,
            value: getPrice(usdcBalance, usdcWeight, perpBalance, perpWeight),
        }))
    console.log({historicData, historicResult});
    const { usdcBalance, perpBalance } = historicResult.slice().pop()
    const fromTimeCountdown = await fetchCountdown(fromBlock).then(res => res.json())
    let cursorBlock = currentBlock >= fromBlock ? currentBlock : fromBlock
    let cursorTime =
        currentBlock >= fromBlock
            ? now
            : now.plus({ seconds: fromTimeCountdown.result.EstimateTimeInSec })

    while (cursorBlock < toBlock) {
        const ratio = (cursorBlock - fromBlock) / totalBlock
        const perpWeight = (PERP_END_WEIGHT - PERP_START_WEIGHT) * ratio + PERP_START_WEIGHT
        const usdcWeight = (USDC_END_WEIGHT - USDC_START_WEIGHT) * ratio + USDC_START_WEIGHT
        const cursorHour = Math.floor(((cursorBlock - fromBlock) * blockDuration) / 60 / 60)
        if (!forecastPrices[cursorHour] === undefined) {
            break
        }
        forecastData.push({
            time: cursorTime.toSeconds() - timezoneOffset,
            value: getPrice(usdcBalance, usdcWeight, perpBalance, perpWeight),
        })

        cursorBlock += indexingInterval / blockDuration
        cursorTime = cursorTime.plus({ seconds: indexingInterval })
    }
    const countDownResponse = await fetchCountdown(toBlock).then(res => res.json())
    const estimateEnd = now.plus({ seconds: countDownResponse.result.EstimateTimeInSec })

    document.getElementById(latestPriceId).textContent = await getLatestPrice().catch(() => historicData[historicData.length - 1].value);

    const countdownDiv = document.getElementById(countdownId)

    window.setInterval(() => {
        const now = luxon.DateTime.local()
        const diff = estimateEnd.diff(now)
        const [days, hours, minutes, seconds] = diff.toFormat("d h m s").split(" ")
        countdownDiv.textContent = `${days} days ${hours} hours ${minutes} minutes ${seconds} seconds`
    }, 1000)

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
            textColor: "#d1d4dc",
            backgroundColor: "#000000",
        },
        timeScale: {
            timeVisible: true,
        },
        grid: {
            vertLines: {
                color: "rgba(42, 46, 57, 0)",
            },
            horzLines: {
                color: "rgba(42, 46, 57, 0)",
            },
        },
    })

    chart
        .addLineSeries({
            color: "rgba(4, 111, 232, 1)",
            lineWidth: 2,
        })
        .setData(historicData)

    chart
        .addLineSeries({
            color: "rgba(255, 255, 255, 0.4)",
            lineWidth: 2,
            lineStyle: 2,
        })
        .setData(forecastData)

    chart.timeScale().fitContent()
}

main()
