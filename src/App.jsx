import React, { useState } from 'react';

function detectarGerencia(linhas) {
  for (const linha of linhas) {
    const l = linha.toLowerCase();

    if (l.includes('pon port:') && l.includes('.lt') && l.includes('.pon')) return 'PRIMARIA_CSV';
    if (l.includes('ont:') && l.includes('.lt') && l.includes('.pon')) return 'AMS';
    if (l.includes('ethernet lt port:')) return 'AMS_SFP';
    if (l.includes('frame=') && l.includes('slot=') && l.includes('port=')) return 'IMASTER';
    if (l.includes('onuid')) return 'IMASTER';
    if (l.includes('zte') || l.includes('c600') || l.includes('rack=')) return 'ZTE';

    if (
      linha.includes('\t') &&
      (
        l.includes('off line') ||
        l.includes('link loss') ||
        l.includes('link_loss') ||
        l.includes('/gc') ||
        l.includes('/pon')
      )
    ) {
      return 'UNM2000';
    }
  }

  return 'IMASTER';
}

function extrairPrimariaCsv(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/PON Port:([^,]+)/i);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function extrairOntsAms(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/ONT:[^,\s]+/);
      return match ? match[0] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function extrairSfpAms(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/Ethernet LT Port:([^,]+,SFP)/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function formatarData(dataTexto) {
  if (!dataTexto) return '';

  const match = dataTexto.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);

  if (!match) return '';

  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}

function formatarCliente(onu, contrato) {
  return `ONU ${String(onu).padEnd(4, ' ')} | ${contrato}`;
}

function ordenarInterfaces(lista) {
  return [...new Set(lista)].sort((a, b) => a.localeCompare(b));
}

function gerarTicketsTexto(gerencia, linhas) {
  const data = new Date().toLocaleString('pt-BR');
  let resultadoFinal = '';

  const falhaPrimaria = linhas.some((linha) =>
    linha.toLowerCase().includes('the feeder fiber is broken')
  );

  if (falhaPrimaria) {
    let olt = '';
    let interfaces = [];
    let totalCircuitos = 0;

    linhas.forEach((linha) => {
      const oltMatch = linha.match(/(olt[^\s,\t]+)/i);
      const slotMatch = linha.match(/Slot=(\d+)/i);
      const portMatch = linha.match(/Port=(\d+)/i);
      const afetadosMatch = linha.match(/The number of affected ONTs=(\d+)/i);

      if (oltMatch) olt = oltMatch[1];

      if (slotMatch && portMatch) {
        interfaces.push(`${slotMatch[1]}/${portMatch[1]}`);
      }

      if (afetadosMatch) {
        totalCircuitos += Number(afetadosMatch[1]);
      }
    });

    interfaces = ordenarInterfaces(interfaces);

    resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: Falha em rede Primaria, OLT: ${olt}
Hora/data: ${data}
Equipamento: OLT: ${olt}

Interface: ${interfaces.join(', ')}
Circuitos afetados: ${totalCircuitos}

Fone NOC 3318-7890

`;

    interfaces.forEach((item) => {
      const [slot, port] = item.split('/');
      resultadoFinal += `Slot:${slot}/Port:${port}\n`;
    });

    resultadoFinal += '\n\n';
  }

  if (gerencia === 'UNM2000') {
    let olt = '';
    let interfaces = [];
    let dataAlarme = '';

    linhas.forEach((linha) => {
      const oltMatch = linha.match(/\t([A-Z0-9-]+)\t/i);
      const interfaceMatch = linha.match(/([A-Z0-9-]+\/GC\d+B\[\d+\]\/PON\d+)/i);
      const dataMatch = linha.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);

      if (oltMatch && !olt) {
        olt = oltMatch[1];
      }

      if (interfaceMatch) {
        interfaces.push(interfaceMatch[1]);
      }

      if (dataMatch && !dataAlarme) {
        dataAlarme = formatarData(dataMatch[1]);
      }
    });

    interfaces = ordenarInterfaces(interfaces);

    resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: Falha em rede Primaria, OLT: ${olt}
Hora/data: ${dataAlarme || data}
Equipamento: ${olt}

Interface:
${interfaces.join('\n')}

Circuitos afetados: ${interfaces.length}

Fone NOC 3318-7890
`;

    return resultadoFinal.trim();
  }

  if (gerencia === 'IMASTER') {
    const agrupado = {};
    const equipamentos = new Set();
    let totalCircuitos = 0;

    linhas.forEach((linha) => {
      if (!linha.toLowerCase().includes('distribute fiber')) return;

      const oltMatch = linha.match(/(olt[^\s,\t]+)/i);
      const slotMatch = linha.match(/Slot=(\d+)/i);
      const portMatch = linha.match(/Port=(\d+)/i);
      const onuMatch = linha.match(/ONUID=(\d+)/i);

      const contratoMatch = linha.match(
        /Description of the ONT\(only for NMS\)=(\d+)|ONT Password=(\d+)/i
      );

      if (!oltMatch || !slotMatch || !portMatch || !onuMatch) return;

      const olt = oltMatch[1];
      const slot = slotMatch[1];
      const port = portMatch[1];
      const onu = onuMatch[1];

      let contrato = 'NCE';

      if (contratoMatch) {
        contrato = contratoMatch[1] || contratoMatch[2] || 'NCE';
      }

      equipamentos.add(olt);
      totalCircuitos++;

      const chave = `${olt}-${slot}-${port}`;

      if (!agrupado[chave]) {
        agrupado[chave] = {
          olt,
          slot,
          port,
          clientes: []
        };
      }

      agrupado[chave].clientes.push({
        onu,
        contrato
      });
    });

    if (totalCircuitos > 0) {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha em rede Secundaria OLT: ${Array.from(equipamentos)[0]} - circuitos afetados: ${totalCircuitos}
Equipamento: ${Array.from(equipamentos).join(', ')}
Alarme: loss
Data/Hora: ${data} BRT


`;
    }

    Object.values(agrupado).forEach((grupo) => {
      resultadoFinal += `${grupo.olt} - ${grupo.slot}/${grupo.port}\n`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultadoFinal += `${formatarCliente(cliente.onu, cliente.contrato)}\n`;
        });

      resultadoFinal += '\n';
    });

    return resultadoFinal.trim();
  }

  return resultadoFinal || 'Nenhum alarme reconhecido.';
}

function processarTexto(texto) {
  const linhas = texto.split('\n').filter(Boolean);
  const gerencia = detectarGerencia(linhas);

  if (gerencia === 'AMS') return extrairOntsAms(linhas);
  if (gerencia === 'AMS_SFP') return extrairSfpAms(linhas);
  if (gerencia === 'PRIMARIA_CSV') return extrairPrimariaCsv(linhas);

  return gerarTicketsTexto(gerencia, linhas);
}

export default function App() {
  const [entrada, setEntrada] = useState('');
  const [resultado, setResultado] = useState('');

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'Arial',
        maxWidth: '1000px',
        margin: '0 auto'
      }}
    >
      <h1>🔧 Huawei, UNM2000, AMS5520 e ZTE</h1>

      <textarea
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        placeholder="Cole os alarmes aqui..."
        style={{
          width: '100%',
          height: '250px',
          padding: '10px',
          marginBottom: '10px'
        }}
      />

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={() => setResultado(processarTexto(entrada))}
          style={{
            marginRight: '10px',
            padding: '10px 20px'
          }}
        >
          Gerar Alarme
        </button>

        <button
          onClick={() => {
            setEntrada('');
            setResultado('');
          }}
          style={{
            padding: '10px 20px'
          }}
        >
          Limpar
        </button>
      </div>

      <textarea
        value={resultado}
        readOnly
        placeholder="Resultado aparecerá aqui..."
        style={{
          width: '100%',
          height: '250px',
          padding: '10px'
        }}
      />
    </div>
  );
}
