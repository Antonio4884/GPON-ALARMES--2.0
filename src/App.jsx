import React, { useState } from 'react';

function detectarGerencia(linhas) {
  for (const linha of linhas) {
    const l = linha.toLowerCase();

    if (l.includes('pon port:') && l.includes('.lt') && l.includes('.pon')) return 'PRIMARIA_CSV';
    if (l.includes('ont:') && l.includes('.lt') && l.includes('.pon')) return 'AMS';
    if (l.includes('ethernet lt port:')) return 'AMS_SFP';
    if (l.includes('frame=') && l.includes('slot=') && l.includes('port=')) return 'IMASTER';
    if (l.includes('onuid')) return 'IMASTER';
    if (l.includes('zte') || l.includes('com.zte')) return 'ZTE';

    if (linha.includes('\t') && (l.includes('off line') || l.includes('link loss'))) {
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

function gerarTicketsTexto(gerencia, linhas) {
  const data = new Date().toLocaleString('pt-BR');

  const falhaPrimaria = linhas.some((linha) =>
    linha.toLowerCase().includes('the feeder fiber is broken')
  );

  if (falhaPrimaria) {
    return `-:CARIMBO DE ABERTURA - NOC:-.
Falha primária detectada
Hora/data: ${data}`;
  }

  if (gerencia === 'IMASTER') {
    const agrupado = {};

    linhas.forEach((linha) => {
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

      const chave = `${olt}-${slot}-${port}`;

      if (!agrupado[chave]) {
        agrupado[chave] = {
          olt,
          slot,
          port,
          clientes: []
        };
      }

      agrupado[chave].clientes.push({ onu, contrato });
    });

    let resultado = '';

    Object.values(agrupado).forEach((grupo) => {
      resultado += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: Secundaria :${grupo.olt} - ${grupo.slot}/${grupo.port}
Hora/data: ${data}
Circuitos Afetados: ${grupo.clientes.length}

Interface: ${grupo.olt} - ${grupo.slot}/${grupo.port} - Secundaria

`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultado += `ONU ${cliente.onu} - Contrato ${cliente.contrato}\n`;
        });

      resultado += '\n';
    });

    return resultado.trim();
  }

  if (gerencia === 'UNM2000') {
    const agrupado = {};

    linhas.forEach((linha) => {
      const colunas = linha.split('\t');

      if (colunas.length < 6) return;

      const cliente = colunas[1] || '';

      let contrato = cliente;
      if (cliente.includes('_')) {
        contrato = cliente.split('_')[0];
      } else if (cliente.includes(' ')) {
        contrato = cliente.split(' ')[0];
      }

      const slot = colunas[3];
      const port = colunas[4];
      const onu = colunas[5];

      const olt = 'OLT-UNM';
      const chave = `${olt}-${slot}-${port}`;

      if (!agrupado[chave]) {
        agrupado[chave] = {
          olt,
          slot,
          port,
          clientes: []
        };
      }

      agrupado[chave].clientes.push({ onu, contrato });
    });

    let resultado = '';

    Object.values(agrupado).forEach((grupo) => {
      resultado += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: Secundaria :${grupo.olt} - ${grupo.slot}/${grupo.port}
Hora/data: ${data}
Circuitos Afetados: ${grupo.clientes.length}

Interface: ${grupo.olt} - ${grupo.slot}/${grupo.port} - Secundaria

`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultado += `ONU ${cliente.onu} - Contrato ${cliente.contrato}\n`;
        });

      resultado += '\n';
    });

    return resultado.trim();
  }

  return `-:CARIMBO DE ABERTURA - NOC:-.
Gerência detectada: ${gerencia}
Hora/data: ${data}

${linhas.join('\n')}`;
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
        style={{
          width: '100%',
          height: '250px',
          padding: '10px'
        }}
      />
    </div>
  );
}
