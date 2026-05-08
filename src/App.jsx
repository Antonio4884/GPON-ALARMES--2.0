import React, { useState } from 'react';

function detectarGerencia(linhas) {
  for (const linha of linhas) {
    const l = linha.toLowerCase();

    if (l.includes('pon port:') && l.includes('.lt') && l.includes('.pon')) return 'PRIMARIA_CSV';
    if (l.includes('ont:') && l.includes('.lt') && l.includes('.pon')) return 'AMS';
    if (l.includes('ethernet lt port:')) return 'AMS_SFP';

    if (
      l.includes('the feeder fiber is broken') ||
      l.includes('expected optical signals')
    ) {
      return 'IMASTER_PRIMARIA';
    }

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

function formatarCliente(onu, contrato) {
  return `ONU ${String(onu).padEnd(4, ' ')} - ${contrato}`;
}

function ordenarInterfaces(lista) {
  return [...new Set(lista)].sort((a, b) => {
    const [slotA, portA] = a.split('/').map(Number);
    const [slotB, portB] = b.split('/').map(Number);

    if (slotA !== slotB) {
      return slotA - slotB;
    }

    return portA - portB;
  });
}

function gerarTicketsTexto(gerencia, linhas) {
  const data = new Date().toLocaleString('pt-BR');
  let resultadoFinal = '';

  // IMASTER PRIMÁRIA
  if (gerencia === 'IMASTER_PRIMARIA') {
    let olt = '';
    let interfaces = [];
    let totalCircuitos = 0;

    linhas.forEach((linha) => {
      const oltMatch = linha.match(/(olt[^\s,\t]+)/i);
      const slotMatch = linha.match(/Slot=(\d+)/i);
      const portMatch = linha.match(/Port=(\d+)/i);
      const totalMatch = linha.match(/The number of affected ONTs=(\d+)/i);

      if (oltMatch && !olt) {
        olt = oltMatch[1];
      }

      if (slotMatch && portMatch) {
        interfaces.push(`${slotMatch[1]}/${portMatch[1]}`);
      }

      if (totalMatch) {
        totalCircuitos += Number(totalMatch[1]);
      }
    });

    interfaces = ordenarInterfaces(interfaces);

    resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: - Falha em rede Primaria, OLT: ${olt} - Circuitos afetados: ${totalCircuitos}
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

    return resultadoFinal.trim();
  }

  // UNM2000
  if (gerencia === 'UNM2000') {
    const temSecundaria = linhas.some((linha) =>
      /\/PON\d+\/\d+.*:\[\d+\]/i.test(linha)
    );

    if (temSecundaria) {
      const agrupado = {};
      let olt = '';
      let totalCircuitos = 0;

      linhas.forEach((linha) => {
        const match = linha.match(
          /([A-Z0-9-]+)\/GC(?:\d+)?OB?\[(\d+)\]\/PON(\d+)\/(\d+).*:\[(\d+)\]/i
        );

        if (!match) return;

        const [, oltNome, slot, pon, contrato, onu] = match;

        olt = oltNome;
        totalCircuitos++;

        const chave = `${oltNome}-${slot}-${pon}`;

        if (!agrupado[chave]) {
          agrupado[chave] = {
            olt: oltNome,
            slot,
            port: pon,
            clientes: []
          };
        }

        agrupado[chave].clientes.push({ onu, contrato });
      });

      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha em rede Secundaria OLT: ${olt} - circuitos afetados: ${totalCircuitos}
Equipamento: ${olt}
Alarme: LINK LOSS
Data/Hora: ${data} BRT


`;

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

    let olt = '';
    let interfaces = [];

    linhas.forEach((linha) => {
      const oltMatch = linha.match(/\t([A-Z0-9-]+)\t/i);
      const interfaceMatch = linha.match(/([A-Z0-9-]+\/GC.*\/PON\d+)/i);

      if (oltMatch && !olt) olt = oltMatch[1];
      if (interfaceMatch) interfaces.push(interfaceMatch[1]);
    });

    interfaces = ordenarInterfaces(interfaces);

    resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: Falha em rede Primaria, OLT: ${olt}
Hora/data: ${data}
Equipamento: ${olt}

Interface:
${interfaces.join('\n')}

Circuitos afetados: ${interfaces.length}

Fone NOC 3318-7890
`;

    return resultadoFinal.trim();
  }

  // ZTE
  if (gerencia === 'ZTE') {
    let olt = '';
    let slot = '';
    let port = '';

    linhas.forEach((linha) => {
      const oltMatch = linha.match(/(olt[^\s,\t]+)/i);
      const slotMatch = linha.match(/SLOT=(\d+)/i);
      const portMatch = linha.match(/PORT=(\d+)/i);

      if (oltMatch) olt = oltMatch[1];
      if (slotMatch) slot = slotMatch[1];
      if (portMatch) port = portMatch[1];
    });

    resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha em rede ZTE
OLT: ${olt}
Interface: ${slot}/${port}
Data/Hora: ${data}
`;

    return resultadoFinal.trim();
  }

  return 'Nenhum alarme reconhecido.';
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
    <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '1000px', margin: '0 auto' }}>
      <h1>🔧 Huawei, UNM2000, AMS5520 e ZTE</h1>

      <textarea
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        placeholder="Cole os alarmes aqui..."
        style={{ width: '100%', height: '250px', padding: '10px', marginBottom: '10px' }}
      />

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={() => setResultado(processarTexto(entrada))}
          style={{ marginRight: '10px', padding: '10px 20px' }}
        >
          Gerar Alarme
        </button>

        <button
          onClick={() => {
            setEntrada('');
            setResultado('');
          }}
          style={{ padding: '10px 20px' }}
        >
          Limpar
        </button>
      </div>

      <textarea
        value={resultado}
        readOnly
        placeholder="Resultado aparecerá aqui..."
        style={{ width: '100%', height: '250px', padding: '10px' }}
      />
    </div>
  );
}
